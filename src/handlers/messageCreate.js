const { buildContainerMessage } = require("../components/containerBuilder");
const { getPrefix, getMusicChannel } = require("../database/guildConfig");
const { isNoPrefixActive } = require("../database/noPrefix");
const { getActiveUserPrefix } = require("../premium/profile");
const { processAfkMentions, clearAuthorAfkIfNeeded } = require("../general/afkService");

const MUSIC_LOCK_COMMANDS = new Set([
    "play",
    "pause",
    "resume",
    "skip",
    "stop",
    "disconnect",
    "queue",
    "nowplaying",
    "volume",
    "loop",
    "lyrics",
    "filter",
    "spplay"
]);

function toFallbackText(payload) {
    const lines = [];
    if (payload?.title) lines.push(`**${payload.title}**`);
    if (payload?.description) lines.push(payload.description);
    if (Array.isArray(payload?.fields)) {
        for (const field of payload.fields) {
            lines.push(`**${field.name}:** ${field.value}`);
        }
    }
    if (payload?.footer) lines.push(payload.footer);
    return lines.join("\n").slice(0, 1900) || "Done.";
}

function mentionsBot(message, botId) {
    return Boolean(message.mentions?.users?.has(botId));
}

function isMentionOnlyMessage(message, botId) {
    const raw = String(message.content || "").trim();
    if (!raw) return false;
    return raw === `<@${botId}>` || raw === `<@!${botId}>`;
}

function isMusicCommand(commandName, args) {
    if (!commandName) return false;
    if (MUSIC_LOCK_COMMANDS.has(commandName)) return true;

    if (commandName === "favorite") {
        const sub = String(args?.[0] || "").toLowerCase();
        return ["play", "addqueue", "queueadd"].includes(sub);
    }

    if (commandName === "playlist") {
        const sub = String(args?.[0] || "").toLowerCase();
        return ["load", "addqueue", "queueadd", "autoload"].includes(sub);
    }

    return false;
}

function buildMentionPayload(bot, prefix) {
    const id = bot.client.user?.id;
    const avatar = bot.client.user?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;

    const children = [
        { type: 10, content: "## Hello, I am Hima" },
        { type: 14, divider: true, spacing: 1 },
        {
            type: 9,
            components: [
                {
                    type: 10,
                    content: `Thanks for mentioning me. I am your high-performance Discord music bot powered by Lavalink, built for smooth, low-latency playback and premium user experience. It features direct Spotify integration, real-time audio filters, dynamic music cards, advanced queue management, and per-user or per-guild custom prefixes with optional no-prefix mode.\n\nMy default prefix is \`${prefix}\` and you can start in seconds.`
                }
            ],
            ...(avatar
                ? {
                    accessory: {
                        type: 11,
                        media: { url: avatar }
                    }
                }
                : {})
        },
        { type: 14, divider: true, spacing: 1 },
        {
            type: 10,
            content: `**Quick Start**\n1. \`${prefix}play <song name/url>\`\n2. \`${prefix}queue\`\n3. \`${prefix}nowplaying\`\n4. \`${prefix}help\``
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `Need full command list? Use \`${prefix}help\`` },
        { type: 10, content: `-# Bot ID: ${id || "Unknown"}` }
    ];

    return {
        flags: 1 << 15,
        components: [{ type: 17, components: children }]
    };
}

function parseCommandInput(message, userPrefix, guildPrefix) {
    const hasUserPrefix = Boolean(userPrefix && message.content.startsWith(userPrefix));
    const hasGuildPrefix = message.content.startsWith(guildPrefix);
    const usedPrefix = hasUserPrefix ? userPrefix : hasGuildPrefix ? guildPrefix : null;

    return {
        hasUserPrefix,
        hasGuildPrefix,
        usedPrefix,
        input: usedPrefix
            ? message.content.slice(usedPrefix.length).trim()
            : message.content.trim()
    };
}

function resolveCommand(bot, input) {
    if (!input.length) return { rawName: null, commandName: null, command: null, args: [] };

    const parts = input.split(/\s+/);
    const rawName = String(parts.shift() || "").toLowerCase();
    const args = parts;

    const commandName = bot.aliasMap.get(rawName) || rawName;
    const command = bot.commandMap.get(commandName) || null;

    return { rawName, commandName, command, args };
}

function registerMessageCreateHandler(bot) {
    bot.client.on("messageCreate", async (message) => {
        if (!message.guild || message.author.bot) return;
        if (!message.content) return;

        const guildPrefix = await getPrefix(message.guild.id);
        const userPrefix = await getActiveUserPrefix(message.author.id).catch(() => null);

        if (mentionsBot(message, bot.client.user.id)) {
            const mentionOnly = isMentionOnlyMessage(message, bot.client.user.id);
            if (mentionOnly) {
                await message.reply(buildMentionPayload(bot, guildPrefix)).catch(() => null);
                return;
            }

            await message.reply(buildMentionPayload(bot, guildPrefix)).catch(() => null);
        }

        const parsed = parseCommandInput(message, userPrefix, guildPrefix);
        const hasNoPrefix = parsed.usedPrefix
            ? false
            : await isNoPrefixActive(message.author.id).catch(() => false);

        let commandMeta = { rawName: null, commandName: null, command: null, args: [] };
        if (parsed.input.length && (parsed.usedPrefix || hasNoPrefix)) {
            commandMeta = resolveCommand(bot, parsed.input);
        }

        await processAfkMentions(bot, message).catch((error) => {
            console.error("[AFK Mention Error]", error?.message || error);
        });

        const skipAutoClear = commandMeta.commandName === "afk";
        await clearAuthorAfkIfNeeded(bot, message, skipAutoClear).catch((error) => {
            console.error("[AFK Clear Error]", error?.message || error);
        });

        if (!parsed.usedPrefix && !hasNoPrefix) return;
        if (!parsed.input.length) return;

        const { command, commandName, args } = commandMeta;
        if (!command) return;

        const reply = async (payload) => {
            try {
                return await message.reply(buildContainerMessage(payload));
            } catch (error) {
                console.error("[Reply ComponentsV2 Error]", error?.message || error);
                try {
                    return await message.reply({
                        content: toFallbackText(payload),
                        allowedMentions: { repliedUser: false }
                    });
                } catch (fallbackError) {
                    console.error("[Reply Fallback Error]", fallbackError?.message || fallbackError);
                    return null;
                }
            }
        };

        const lockedMusicChannelId = await getMusicChannel(message.guild.id).catch(() => null);
        if (
            lockedMusicChannelId &&
            commandName !== "musicchannel" &&
            isMusicCommand(commandName, args) &&
            message.channel.id !== lockedMusicChannelId
        ) {
            await reply({
                title: "Music Channel Locked",
                description: `Use music commands in <#${lockedMusicChannelId}> only.`,
                footer: "Admins can change this with musicchannel set/clear"
            });
            return;
        }

        try {
            await command.execute({
                bot,
                message,
                args,
                prefix: parsed.usedPrefix || guildPrefix,
                reply
            });
        } catch (error) {
            console.error(`[Command Error:${commandName}]`, error);
            await reply({
                title: "Command Error",
                description: "Something went wrong while executing that command.",
                fields: [{ name: "Error", value: String(error.message || error) }]
            });
        }
    });
}

module.exports = { registerMessageCreateHandler };
