function getUserMetrics(client) {
    const guilds = Array.from(client.guilds.cache.values());

    const guildUserTotal = guilds.reduce((sum, guild) => {
        const count = Number(guild.memberCount || 0);
        return sum + (Number.isFinite(count) ? count : 0);
    }, 0);

    return {
        guilds: guilds.length,
        totalUsers: guildUserTotal,
        cachedUsers: client.users.cache.size
    };
}

module.exports = { getUserMetrics };
