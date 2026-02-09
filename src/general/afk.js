const { MessageFlags } = require("discord.js");
const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("../premium/profile");
const { voteUrl, buyUrl } = require("../premium/service");
const {
    getGlobalAfk,
    getGuildAfk,
    getEffectiveAfk
} = require("../database/afk");
const { enableAfk, disableAfk } = require("./afkService");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const PANEL_TTL_MS = 10 * 60 * 1000;
const panels = new Map();

function formatTime(ts) {
    const unix = Math.floor(new Date(ts || 0).getTime() / 1000);
    if (!Number.isFinite(unix) || unix <= 0) return "Unknown";
    return `<t:${unix}:F> (<t:${unix}:R>)`;
}

function parseArgs(args) {
    const first = String(args[0] || "").toLowerCase();
    const known = new Set(["server", "global", "status", "off", "help"]);

    if (known.has(first)) {
        return {
            mode: first,
            reason: args.slice(1).join(" ").trim()
        };
    }

    return {
        mode: "",
        reason: args.join(" ").trim()
    };
}

function buildStatusText(server, global) {
    const lines = [];

    if (server) {
        lines.push(`**Server AFK**\nReason: ${server.reason}\nSince: ${formatTime(server.setAt)}`);
    } else {
        lines.push("**Server AFK**\nNot active.");
    }

    if (global) {
        lines.push(`**Global AFK**\nReason: ${global.reason}\nSince: ${formatTime(global.setAt)}`);
    } else {
        lines.push("**Global AFK**\nNot active.");
    }

    return lines.join("\n\n");
}

function createToken() {
    return Math.random().toString(36).slice(2, 10);
}

function cleanPanels() {
    const now = Date.now();
    for (const [token, panel] of panels.entries()) {
        if (panel.expiresAt <= now) panels.delete(token);
    }
}

async function hasPremiumAccess(userId) {
    const voteActive = await isVotePremiumActive(userId).catch(() => false);
    const paidActive = await hasUserPaidPremiumAccess(userId).catch(() => false);
    return voteActive || paidActive;
}

function buildChoosePayload({ token, reason, userId }) {
    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## AFK Setup" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Choose AFK mode from buttons below." },
                    { type: 10, content: `**Reason**\n${reason}` },
                    {
                        type: 1,
                        components: [
                            { type: 2, style: 1, custom_id: `afk_choose:${token}:server`, label: "Server AFK" },
                            { type: 2, style: 1, custom_id: `afk_choose:${token}:global`, label: "Global AFK" }
                        ]
                    },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: `Only <@${userId}> can use these buttons.` }
                ]
            }
        ]
    };
}

function buildEnabledPayload({ scope, reason, setAt, userId }) {
    const scopeText = scope === "global" ? "Global" : "Server";
    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: `## ${scopeText} AFK Enabled` },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: `AFK is active for <@${userId}>.` },
                    { type: 10, content: `**Reason**\n${reason}` },
                    { type: 10, content: `**Set At**\n${formatTime(setAt)}` },
                    { type: 10, content: `**Nickname**\nPrefixed with [AFK] where bot has permission.` },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "AFK will auto-clear on your next message and nickname will restore." }
                ]
            }
        ]
    };
}

module.exports = {
    name: "afk",
    aliases: ["setafk"],
    description: "Advanced AFK system with server/global modes (premium).",
    usage: "afk [server|global|status|off] [reason]",

    async execute({ bot, message, args, reply }) {
        cleanPanels();
        const { mode, reason } = parseArgs(args);

        if (mode === "help") {
            await reply({
                title: "AFK Help",
                description: "Set AFK in server scope or global scope.",
                fields: [
                    { name: "Interactive", value: "`afk [reason]`" },
                    { name: "Direct Server", value: "`afk server <reason>`" },
                    { name: "Direct Global", value: "`afk global <reason>`" },
                    { name: "Status", value: "`afk status [@user]`" },
                    { name: "Off", value: "`afk off`" }
                ],
                footer: "AFK set mode requires vote premium or buy premium"
            });
            return;
        }

        if (mode === "off") {
            await disableAfk(bot, {
                guildId: message.guild.id,
                userId: message.author.id,
                scope: "all"
            });
            await reply({
                title: "AFK Disabled",
                description: "Your server/global AFK removed and nickname restored."
            });
            return;
        }

        if (mode === "status") {
            const target = message.mentions.users.first() || message.author;
            const [server, global] = await Promise.all([
                getGuildAfk(message.guild.id, target.id),
                getGlobalAfk(target.id)
            ]);

            await message.reply({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## AFK Status" },
                            { type: 14, divider: true, spacing: 1 },
                            {
                                type: 9,
                                components: [{ type: 10, content: `<@${target.id}>` }],
                                accessory: {
                                    type: 11,
                                    media: {
                                        url: target.displayAvatarURL({ extension: "png", size: 512 })
                                    }
                                }
                            },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: buildStatusText(server, global) }
                        ]
                    }
                ]
            });
            return;
        }

        const hasPremium = await hasPremiumAccess(message.author.id);
        if (!hasPremium) {
            await message.reply({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Premium Required" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "AFK system is available for vote premium or buy premium users." },
                            {
                                type: 1,
                                components: [
                                    { type: 2, style: 5, label: "Vote Premium", url: voteUrl(bot) },
                                    { type: 2, style: 5, label: "Buy Premium", url: buyUrl() }
                                ]
                            }
                        ]
                    }
                ]
            });
            return;
        }

        if (mode === "server" || mode === "global") {
            const entry = await enableAfk(bot, message, {
                scope: mode,
                reason: reason || "I am currently away."
            });

            await message.reply(buildEnabledPayload({
                scope: mode,
                reason: entry.reason,
                setAt: entry.setAt,
                userId: message.author.id
            }));
            return;
        }

        const token = createToken();
        panels.set(token, {
            userId: message.author.id,
            guildId: message.guild.id,
            channelId: message.channel.id,
            reason: reason || "I am currently away.",
            expiresAt: Date.now() + PANEL_TTL_MS
        });

        await message.reply(buildChoosePayload({
            token,
            reason: reason || "I am currently away.",
            userId: message.author.id
        }));
    },

    async handleInteraction({ bot, interaction }) {
        if (!interaction.isButton()) return false;
        if (!interaction.customId.startsWith("afk_choose:")) return false;

        cleanPanels();
        const [, token, mode] = interaction.customId.split(":");
        const panel = panels.get(token);

        if (!panel || panel.expiresAt <= Date.now()) {
            panels.delete(token);
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## AFK Panel Expired" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "Run afk command again." }
                        ]
                    }
                ]
            }).catch(() => null);
            return true;
        }

        if (interaction.user.id !== panel.userId) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        if (mode !== "server" && mode !== "global") {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const hasPremium = await hasPremiumAccess(interaction.user.id);
        if (!hasPremium) {
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Premium Required" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "AFK system is available for vote premium or buy premium users." },
                            {
                                type: 1,
                                components: [
                                    { type: 2, style: 5, label: "Vote Premium", url: voteUrl(bot) },
                                    { type: 2, style: 5, label: "Buy Premium", url: buyUrl() }
                                ]
                            }
                        ]
                    }
                ]
            }).catch(() => null);
            return true;
        }

        const guild = await bot.client.guilds.fetch(panel.guildId).catch(() => null);
        if (!guild) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const fakeMessage = {
            author: interaction.user,
            guild,
            channel,
            member: interaction.member
        };

        const entry = await enableAfk(bot, fakeMessage, {
            scope: mode,
            reason: panel.reason
        });

        panels.delete(token);

        await interaction.update(buildEnabledPayload({
            scope: mode,
            reason: entry.reason,
            setAt: entry.setAt,
            userId: interaction.user.id
        })).catch(() => null);

        return true;
    }
};
