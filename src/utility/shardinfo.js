const { buildUtilityPayload } = require("./card");

module.exports = {
    name: "shardinfo",
    aliases: ["shard"],
    description: "Show shard and gateway details.",
    usage: "shardinfo",
    async execute({ bot, message }) {
        const shardId = message.guild?.shardId ?? 0;
        const wsPing = Number(bot.client.ws.ping || 0);
        const shards = bot.client.ws.shards?.size || 1;

        await message.reply(buildUtilityPayload({
            bot,
            title: "Shard Info",
            summary: "Gateway shard runtime details.",
            details: [
                `**Current Shard ID:** ${shardId}`,
                `**Total Local Shards:** ${shards}`,
                `**Gateway Ping:** ${wsPing}ms`,
                `**Status:** ${wsPing < 120 ? "Excellent" : wsPing < 250 ? "Stable" : "Slow"}`
            ],
            footer: "Hima Shard Monitor"
        }));
    }
};
