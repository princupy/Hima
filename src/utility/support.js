const { buildUtilityPayload } = require("./card");

module.exports = {
    name: "support",
    aliases: ["supportserver"],
    description: "Get support links for Hima.",
    usage: "support",
    async execute({ bot, message }) {
        const serverUrl = process.env.NO_PREFIX_CONTACT_DISCORD_URL || "https://discord.gg/37WBxRXVq5";
        const instaUrl = process.env.NO_PREFIX_CONTACT_INSTAGRAM_URL || "https://www.instagram.com/tanmoy_here8388/";
        const dmUrl = bot.config?.noPrefix?.ownerId
            ? `https://discord.com/users/${bot.config.noPrefix.ownerId}`
            : serverUrl;

        await message.reply(buildUtilityPayload({
            bot,
            title: "Support",
            summary: "Need help with setup, music issues, or premium features?",
            details: [
                "**Use the buttons below to contact support.**",
                "Fastest response is usually on Discord server."
            ],
            buttons: [
                {
                    label: "Discord",
                    url: serverUrl,
                    emoji: process.env.NO_PREFIX_CONTACT_DISCORD_EMOJI || "<:icons8discord48:1458468876797177997>"
                },
                {
                    label: "Instagram",
                    url: instaUrl,
                    emoji: process.env.NO_PREFIX_CONTACT_INSTAGRAM_EMOJI || "<:icons8instagram48:1458468893096237217>"
                },
                {
                    label: "Direct DM",
                    url: dmUrl,
                    emoji: process.env.NO_PREFIX_CONTACT_DM_EMOJI || "<:icons8chat48:1458468907281506324>"
                }
            ],
            footer: "Hima Support Center"
        }));
    }
};
