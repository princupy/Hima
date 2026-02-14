const { buildUtilityPayload } = require("./card");

const WEBSITE_URL = "https://hima-beryl.vercel.app/";

module.exports = {
    name: "website",
    aliases: ["site", "web"],
    description: "Open Hima official website.",
    usage: "website",
    async execute({ bot, message }) {
        await message.reply(buildUtilityPayload({
            bot,
            title: "Hima Website",
            summary: "Open Hima official web panel to explore features, commands, and premium systems.",
            buttons: [
                {
                    label: "Open Website",
                    url: WEBSITE_URL,
                    emoji: process.env.UTILITY_WEBSITE_EMOJI || "??"
                }
            ],
            footer: "Hima Web Access"
        }));
    }
};
