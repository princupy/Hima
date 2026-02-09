const { getVoicePlayEnabled } = require("./store");
const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("../premium/profile");

function extractPlayQuery(text) {
    const value = String(text || "").trim();
    const m = value.match(/^play\s+(.+)$/i);
    if (!m) return null;
    const query = String(m[1] || "").trim();
    return query || null;
}

async function canUseVoicePlay(guildId, userId) {
    const enabled = await getVoicePlayEnabled(guildId, userId).catch(() => false);
    if (!enabled) return false;

    const voteActive = await isVotePremiumActive(userId).catch(() => false);
    const buyActive = await hasUserPaidPremiumAccess(userId).catch(() => false);
    return voteActive || buyActive;
}

async function tryHandleVoicePlayTextTrigger({ bot, message, reply, guildPrefix, userPrefix }) {
    if (!message.guild || !message.member || message.author.bot) return false;
    if (!message.content) return false;

    const text = message.content.trim();
    if (!text) return false;

    if (guildPrefix && text.startsWith(guildPrefix)) return false;
    if (userPrefix && text.startsWith(userPrefix)) return false;

    const query = extractPlayQuery(text);
    if (!query) return false;

    if (!message.member.voice?.channelId) {
        await reply({
            title: "Voice Channel Required",
            description: "Voice Play active hai, lekin aap voice channel me nahi ho."
        });
        return true;
    }

    const allowed = await canUseVoicePlay(message.guild.id, message.author.id);
    if (!allowed) return false;

    const play = bot.commandMap.get("play");
    if (!play) return false;

    const args = query.split(/\s+/).filter(Boolean);
    if (!args.length) return false;

    await play.execute({
        bot,
        message,
        args,
        prefix: guildPrefix,
        reply
    });

    return true;
}

module.exports = { tryHandleVoicePlayTextTrigger };
