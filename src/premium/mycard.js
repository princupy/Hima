const { PermissionFlagsBits } = require("discord.js");
const {
    isGuildVotePremiumActive,
    isGuildAnyPremiumActive,
    getGuildVoteRow,
    isGuildPaidPremiumActive
} = require("./profile");
const { setGuildMusicardTheme, voteUrl, buyUrl } = require("./service");

const AVAILABLE = "`ease`, `glass`, `neon`, `sunset`, `ocean`, `mono`";

module.exports = {
    name: "mycard",
    aliases: ["musicard", "cardui"],
    description: "Set guild musicard theme (guild premium required).",
    usage: "musicard <ease|glass|neon|sunset|ocean|mono>",
    async execute({ bot, message, args, reply }) {
        if (!message.guildId || !message.guild) {
            await reply({
                title: "Guild Only",
                description: "Use this command inside a server."
            });
            return;
        }

        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        const canManageGuild = Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
        if (!canManageGuild) {
            await reply({
                title: "Permission Required",
                description: "You need **Manage Server** permission to change guild musicard."
            });
            return;
        }

        const row = await getGuildVoteRow(message.guildId).catch(() => null);
        const voteActive = await isGuildVotePremiumActive(message.guildId).catch(() => false);
        const paidActive = isGuildPaidPremiumActive(row);
        const active = await isGuildAnyPremiumActive(message.guildId).catch(() => false);

        if (!active) {
            await message.reply({
                flags: 1 << 15,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Guild Premium Required" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "No active guild premium found." },
                            { type: 10, content: "Activate via vote (`vote`) or buy token (`premiumredeem <token>`)." },
                            {
                                type: 1,
                                components: [
                                    { type: 2, style: 5, label: "Vote Premium", url: voteUrl(bot) },
                                    { type: 2, style: 5, label: "Buy Premium", url: buyUrl() }
                                ]
                            }
                        ]
                    }
                ]
            });
            return;
        }

        if (!paidActive && voteActive && row?.voter_user_id && row.voter_user_id !== message.author.id) {
            await reply({
                title: "Access Locked",
                description: `Only <@${row.voter_user_id}> can change this guild's vote musicard during active vote period.`
            });
            return;
        }

        const theme = args[0];
        if (!theme) {
            await reply({
                title: "Missing Theme",
                description: "Usage: musicard <ease|glass|neon|sunset|ocean|mono>",
                fields: [{ name: "Available", value: AVAILABLE }]
            });
            return;
        }

        try {
            const value = await setGuildMusicardTheme(message.guildId, theme);
            await bot.music.refreshNowPlayingCard(message.guildId).catch(() => null);

            await reply({
                title: "Guild Musicard Updated",
                description: `Theme set to **${value}** for this server.`,
                fields: [{ name: "Available", value: AVAILABLE }],
                footer: paidActive
                    ? "Paid premium active in this guild"
                    : "Theme auto-resets to default when vote premium expires"
            });
        } catch (error) {
            await reply({
                title: "Theme Update Failed",
                description: String(error?.message || error),
                fields: [{ name: "Available", value: AVAILABLE }]
            });
        }
    }
};
