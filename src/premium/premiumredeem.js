const { PermissionFlagsBits } = require("discord.js");
const { redeemPremiumToken } = require("./service");

module.exports = {
    name: "premiumredeem",
    aliases: ["redeem", "predeem"],
    description: "Redeem a premium token for this guild (Manage Server required).",
    usage: "premiumredeem <TOKEN>",

    async execute({ bot, message, args, reply }) {
        if (!message.guildId || !message.guild) {
            await reply({
                title: "Guild Only",
                description: "Use this command in a server."
            });
            return;
        }

        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        const canManageGuild = Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
        if (!canManageGuild) {
            await reply({
                title: "Permission Required",
                description: "You need **Manage Server** permission to redeem premium token."
            });
            return;
        }

        const token = args[0];
        if (!token) {
            await reply({
                title: "Missing Token",
                description: "Usage: premiumredeem <TOKEN>"
            });
            return;
        }

        try {
            const out = await redeemPremiumToken({
                bot,
                token,
                guildId: message.guildId,
                userId: message.author.id
            });

            const fields = [
                { name: "Plan", value: out.plan.label },
                { name: "Price", value: `INR ${out.priceInr}` },
                {
                    name: "Premium Until",
                    value: out.guild.premium_is_permanent
                        ? "Permanent"
                        : `<t:${Math.floor(new Date(out.guild.premium_until).getTime() / 1000)}:F>`
                },
                { name: "Guild Theme Access", value: "Use `musicard <theme>` now." }
            ];

            await reply({
                title: "Premium Activated",
                description: "Guild premium has been activated successfully.",
                fields,
                footer: "Buy premium works independent of vote premium"
            });
        } catch (error) {
            await reply({
                title: "Redeem Failed",
                description: String(error.message || error)
            });
        }
    }
};
