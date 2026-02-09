const { MessageFlags } = require("discord.js");
const { formatUptime } = require("../utils/format");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
    name: "stats",
    aliases: [],
    description: "Show bot runtime and shard statistics.",
    usage: "stats",
    async execute({ bot, message }) {
        const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const uptime = formatUptime(process.uptime() * 1000);
        const wsPing = Number(bot.client.ws.ping || 0);
        const guilds = bot.client.guilds.cache.size;
        const users = bot.client.users.cache.size;
        const avatar = bot.client.user?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;

        const children = [
            { type: 10, content: "## Hima Stats" },
            { type: 14, divider: true, spacing: 1 },
            {
                type: 9,
                components: [
                    {
                        type: 10,
                        content: `**Guilds:** ${guilds}\n**Users (cached):** ${users}\n**Uptime:** ${uptime}`
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
            { type: 10, content: "-# Hima Runtime Monitor" }
        ];

        await message.reply({
            flags: COMPONENTS_V2_FLAG,
            components: [{ type: 17, components: children }]
        });
    }
};
