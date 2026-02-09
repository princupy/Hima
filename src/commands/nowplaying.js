const { formatDuration } = require("../utils/format");

module.exports = {
    name: "nowplaying",
    aliases: ["np"],
    description: "Show current track info.",
    usage: "nowplaying",
    async execute({ bot, message, reply }) {
        const now = bot.music.getNowPlaying(message.guild.id);
        if (!now) {
            await reply({ title: "Nothing Playing", description: "No active track." });
            return;
        }

        const t = now.track;
        await reply({
            title: "Now Playing",
            description: `**${t.title}**`,
            fields: [
                { name: "Artist", value: t.author || "Unknown" },
                { name: "Duration", value: formatDuration(t.length) },
                { name: "Position", value: formatDuration(now.position || 0) }
            ],
            image: t.artworkUrl || null
        });
    }
};
