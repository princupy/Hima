const { formatUptime } = require("../utils/format");
const { buildUtilityPayload } = require("./card");

module.exports = {
    name: "uptime",
    aliases: [],
    description: "Show bot uptime details.",
    usage: "uptime",
    async execute({ bot, message }) {
        const up = formatUptime(process.uptime() * 1000);
        await message.reply(buildUtilityPayload({
            bot,
            title: "Uptime",
            summary: "Current runtime status for Hima.",
            details: [
                `**Uptime:** ${up}`,
                `**Started:** <t:${Math.floor((Date.now() - process.uptime() * 1000) / 1000)}:F>`
            ],
            footer: "Hima Uptime Monitor"
        }));
    }
};
