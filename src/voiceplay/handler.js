const { buildContainerMessage } = require("../components/containerBuilder");
const { getVoicePlayEnabled, setVoicePlayEnabled } = require("./store");
const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("../premium/profile");

const cooldownMap = new Map();
const COOLDOWN_MS = 8000;

function cooldownKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function isOnCooldown(guildId, userId) {
    const key = cooldownKey(guildId, userId);
    const until = cooldownMap.get(key) || 0;
    if (until > Date.now()) return true;
    cooldownMap.set(key, Date.now() + COOLDOWN_MS);
    return false;
}

function readSpeechText(speech) {
    const parts = [
        speech?.content,
        speech?.transcript,
        speech?.speech,
        speech?.text,
        speech?.message?.content,
        speech?.speechResult?.transcript,
        speech?.speechData?.content
    ]
        .map((x) => String(x || "").trim())
        .filter(Boolean);

    return parts[0] || "";
}

function extractPlayQuery(speech) {
    const value = readSpeechText(speech);
    if (!value) return null;

    const cleaned = value
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const m = cleaned.match(/^play\s+(.+)$/i);
    if (!m) return null;

    const query = String(m[1] || "").trim();
    if (!query) return null;
    return query;
}

async function pickTextChannel(bot, guild) {
    const state = bot.music.get(guild.id);
    if (state?.textChannelId) {
        const ch = await bot.client.channels.fetch(state.textChannelId).catch(() => null);
        if (ch && ch.isTextBased()) return ch;
    }

    if (guild.systemChannel && guild.systemChannel.isTextBased()) {
        return guild.systemChannel;
    }

    const fallback = guild.channels.cache.find((c) => c.isTextBased() && c.viewable);
    return fallback || null;
}

function buildReply(message) {
    return async (payload) => {
        try {
            return await message.reply(buildContainerMessage(payload));
        } catch {
            return null;
        }
    };
}

function registerVoicePlayHandler(bot) {
    let addSpeechEvent;
    try {
        ({ addSpeechEvent } = require("discord-speech-recognition"));
    } catch {
        console.warn("[VoicePlay] discord-speech-recognition not installed. Voice mode disabled.");
        return;
    }

    try {
        addSpeechEvent(bot.client);
    } catch (error) {
        console.error("[VoicePlay] Speech event init failed:", error?.message || error);
        return;
    }

    bot.client.on("speech", async (speech) => {
        try {
            const guild = speech.guild || speech.member?.guild;
            const user = speech.author || speech.member?.user;
            if (!guild || !user || user.bot) return;

            const member = speech.member
                || await guild.members.fetch(user.id).catch(() => null);
            if (!member?.voice?.channelId) return;

            const enabled = await getVoicePlayEnabled(guild.id, user.id);
            if (!enabled) return;

            const voteActive = await isVotePremiumActive(user.id).catch(() => false);
            const buyActive = await hasUserPaidPremiumAccess(user.id).catch(() => false);
            if (!voteActive && !buyActive) {
                await setVoicePlayEnabled(guild.id, user.id, false).catch(() => null);
                return;
            }

            const query = extractPlayQuery(speech);
            if (!query) return;
            if (isOnCooldown(guild.id, user.id)) return;

            const playCommand = bot.commandMap.get("play");
            if (!playCommand) return;

            const textChannel = await pickTextChannel(bot, guild);
            if (!textChannel) return;

            const fakeMessage = {
                guild,
                guildId: guild.id,
                author: user,
                member,
                channel: textChannel,
                channelId: textChannel.id,
                content: `play ${query}`,
                reply: async (...args) => textChannel.send(...args)
            };

            const args = query.split(/\s+/).filter(Boolean);
            if (!args.length) return;

            await playCommand.execute({
                bot,
                message: fakeMessage,
                args,
                prefix: "voice",
                reply: buildReply(fakeMessage)
            });
        } catch (error) {
            console.error("[VoicePlay] Speech handler error:", error?.message || error);
        }
    });
}

module.exports = { registerVoicePlayHandler };
