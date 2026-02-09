const JOIN_COOLDOWN_MS = 30 * 1000;
const joinCooldown = new Map();

function makeKey(guildId, userId, channelId) {
    return `${guildId}:${userId}:${channelId}`;
}

function isOnCooldown(key) {
    const now = Date.now();
    const value = joinCooldown.get(key);
    if (!value) return false;
    if (value <= now) {
        joinCooldown.delete(key);
        return false;
    }
    return true;
}

function setCooldown(key) {
    joinCooldown.set(key, Date.now() + JOIN_COOLDOWN_MS);
}

function clearExpired() {
    const now = Date.now();
    for (const [key, expires] of joinCooldown) {
        if (expires <= now) joinCooldown.delete(key);
    }
}

function registerPlaylistAutoloadHandler(bot) {
    bot.client.on("voiceStateUpdate", async (oldState, newState) => {
        try {
            if (!newState?.guild || !newState?.member || newState.member.user?.bot) return;

            const oldChannelId = oldState?.channelId || null;
            const newChannelId = newState?.channelId || null;
            if (!newChannelId || oldChannelId === newChannelId) return;

            const current = bot.music.get(newState.guild.id);
            if (current?.current || (Array.isArray(current?.queue) && current.queue.length > 0)) {
                return;
            }

            const key = makeKey(newState.guild.id, newState.member.id, newChannelId);
            if (isOnCooldown(key)) return;
            setCooldown(key);
            clearExpired();

            const playlistCommand = bot.commandMap.get("playlist");
            if (!playlistCommand || typeof playlistCommand.tryAutoLoadOnVoiceJoin !== "function") return;

            await playlistCommand.tryAutoLoadOnVoiceJoin({
                bot,
                guild: newState.guild,
                member: newState.member,
                channel: newState.channel
            }).catch(() => null);
        } catch {
            return;
        }
    });
}

module.exports = {
    registerPlaylistAutoloadHandler
};
