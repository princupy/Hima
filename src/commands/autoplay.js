module.exports = {
    name: "autoplay",
    aliases: ["ap"],
    description: "Toggle automatic similar-song playback when queue ends.",
    usage: "autoplay <on|off|status>",

    async execute({ bot, message, args, reply }) {
        const mode = String(args[0] || "status").toLowerCase();

        const hasPremium = await bot.music.hasPremiumAccess(message.author.id).catch(() => false);
        if (!hasPremium) {
            await reply({
                title: "Premium Required",
                description: "Autoplay is available for vote premium and buy premium users only."
            });
            return;
        }

        if (!["on", "off", "status"].includes(mode)) {
            await reply({
                title: "Invalid Option",
                description: "Use `autoplay on`, `autoplay off`, or `autoplay status`."
            });
            return;
        }

        if (mode === "on") {
            await bot.music.setAutoplay(message.guild.id, {
                enabled: true,
                userId: message.author.id
            });

            await reply({
                title: "Autoplay Enabled",
                description: "When queue ends, similar tracks will be added automatically until you disable autoplay.",
                fields: [
                    { name: "Set By", value: `<@${message.author.id}>` },
                    { name: "State", value: "ON" }
                ]
            });
            return;
        }

        if (mode === "off") {
            await bot.music.setAutoplay(message.guild.id, {
                enabled: false,
                userId: message.author.id
            });

            await reply({
                title: "Autoplay Disabled",
                description: "Automatic similar-song playback has been turned off.",
                fields: [{ name: "State", value: "OFF" }]
            });
            return;
        }

        const status = await bot.music.getAutoplayStatus(message.guild.id).catch(() => ({
            enabled: false,
            configured: false,
            premiumActive: false,
            byUserId: null
        }));

        await reply({
            title: "Autoplay Status",
            description: "Queue-end automatic playback configuration.",
            fields: [
                { name: "State", value: status.enabled ? "ON" : "OFF" },
                { name: "Configured", value: status.configured ? "Yes" : "No" },
                { name: "Premium Active", value: status.premiumActive ? "Yes" : "No" },
                { name: "Set By", value: status.byUserId ? `<@${status.byUserId}>` : "N/A" }
            ]
        });
    }
};
