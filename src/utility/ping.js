const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
    name: "ping",
    aliases: [],
    description: "Show latency and connection health.",
    usage: "ping",
    async execute({ bot, message }) {
        const latency = Date.now() - message.createdTimestamp;
        const wsPing = Number(bot.client.ws.ping || 0);
        const status = wsPing < 120 ? "Excellent" : wsPing < 250 ? "Stable" : "Slow";
        const avatar = bot.client.user?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;

        const children = [
            { type: 10, content: "## Pong" },
            { type: 14, divider: true, spacing: 1 },
            {
                type: 9,
                components: [
                    {
                        type: 10,
                        content: `**Connection Health:** ${status}\n**Message Latency:** ${latency}ms\n**Gateway Ping:** ${wsPing}ms`
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
            { type: 10, content: "-# Hima Network Diagnostics" }
        ];

        await message.reply({
            flags: COMPONENTS_V2_FLAG,
            components: [{ type: 17, components: children }]
        });
    }
};
