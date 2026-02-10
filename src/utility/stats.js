const { MessageFlags } = require("discord.js");
const { formatUptime } = require("../utils/format");
const { getUserMetrics } = require("../utils/userMetrics");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

function formatNodeLine(name, stats) {
    if (!stats || stats.total === 0) return `**${name}:** Not configured`;
    const status = stats.online > 0 ? "Online" : "Offline";
    return `**${name}:** ${status} (${stats.online}/${stats.total} connected)`;
}

module.exports = {
    name: "stats",
    aliases: [],
    description: "Show bot runtime and shard statistics.",
    usage: "stats",
    async execute({ bot, message }) {
        const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const uptime = formatUptime(process.uptime() * 1000);
        const wsPing = Number(bot.client.ws.ping || 0);
        const metrics = getUserMetrics(bot.client);
        const guilds = metrics.guilds;
        const users = metrics.totalUsers;
        const cachedUsers = metrics.cachedUsers;
        const avatar = bot.client.user?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;

        const nodeHealth = bot.music.getNodeHealthSummary?.() || {
            overall: { total: 0, online: 0, offline: 0, allOffline: false },
            default: { total: 0, online: 0, offline: 0 },
            premium: { total: 0, online: 0, offline: 0 }
        };

        const nodeText = [
            formatNodeLine("Default Pool", nodeHealth.default),
            formatNodeLine("Premium Pool", nodeHealth.premium),
            `**Overall:** ${nodeHealth.overall.online}/${nodeHealth.overall.total} connected`,
            `**State:** ${nodeHealth.overall.allOffline ? "All nodes offline" : "Operational"}`
        ].join("\n");

        const children = [
            { type: 10, content: "## Hima Stats" },
            { type: 14, divider: true, spacing: 1 },
            {
                type: 9,
                components: [
                    {
                        type: 10,
                        content: `**Guilds:** ${guilds}\n**Users (Total):** ${users.toLocaleString()}\n**Users (Cached):** ${cachedUsers.toLocaleString()}\n**Uptime:** ${uptime}`
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
            { type: 10, content: `**WS Ping:** ${wsPing}ms\n**RAM:** ${memMb} MB\n**Node:** ${process.version}` },
            { type: 14, divider: true, spacing: 1 },
            { type: 10, content: "**Lavalink Status**\n" + nodeText },
            { type: 14, divider: true, spacing: 1 },
            { type: 10, content: "-# Hima Runtime Monitor" }
        ];

        await message.reply({
            flags: COMPONENTS_V2_FLAG,
            components: [{ type: 17, components: children }]
        });
    }
};


