const { MessageFlags } = require("discord.js");
const { formatDuration } = require("../utils/format");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

function shortText(value, max = 80) {
    const text = String(value || "Unknown").trim();
    if (!text) return "Unknown";
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
}

module.exports = {
    name: "nowplaying",
    aliases: ["np"],
    description: "Show current track info.",
    usage: "nowplaying",
    async execute({ bot, message }) {
        const now = bot.music.getNowPlaying(message.guild.id);
        if (!now) {
            await message.reply({
                flags: COMPONENTS_V2_FLAG,
                components: [{
                    type: 17,
                    components: [
                        { type: 10, content: "## Nothing Playing" },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: "No active track." }
                    ]
                }]
            });
            return;
        }

        const t = now.track;
        const positionMs = Number(now.position || 0);
        const durationMs = Number(t.length || 0);

        const title = shortText(t.title, 70);
        const trackLine = t.uri ? `[${title}](${t.uri})` : title;
        const requester = t.requesterId ? `<@${t.requesterId}>` : (t.requester || "Unknown");
        const durationText = durationMs > 0
            ? `${formatDuration(positionMs)} / ${formatDuration(durationMs)}`
            : "LIVE";

        const details = [
            `**Track:** ${trackLine}`,
            `**Author:** ${shortText(t.author || "Unknown", 40)}`,
            `**Duration:** ${durationText}`,
            `**Requested By:** ${requester}`
        ].join("\n");

        const components = [
            { type: 10, content: "## Now Playing" },
            { type: 14, divider: true, spacing: 1 },
            {
                type: 9,
                components: [{ type: 10, content: details }],
                ...(t.artworkUrl
                    ? {
                        accessory: {
                            type: 11,
                            media: { url: t.artworkUrl }
                        }
                    }
                    : {})
            }
        ];

        await message.reply({
            flags: COMPONENTS_V2_FLAG,
            components: [{ type: 17, components }]
        });
    }
};
