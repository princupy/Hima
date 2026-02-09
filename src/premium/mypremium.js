const {
    getUserPremiumRow,
    isActiveVote,
    getGuildVoteRow,
    isGuildPaidPremiumActive,
    isGuildAnyPremiumRowActive,
    hasUserPaidPremiumAccess,
    getGuild247Settings
} = require("./profile");

module.exports = {
    name: "mypremium",
    aliases: ["premstatus"],
    description: "Show user vote/buy premium and guild premium status.",
    usage: "mypremium",
    async execute({ message, reply }) {
        const row = await getUserPremiumRow(message.author.id).catch(() => null);
        if (!row) {
            await reply({
                title: "No Premium Profile",
                description: "You have no premium data yet. Vote first using `vote` command."
            });
            return;
        }

        const voteActive = isActiveVote(row);
        const buyActive = await hasUserPaidPremiumAccess(message.author.id).catch(() => false);

        const fields = [
            { name: "User Vote Premium", value: voteActive ? "Active" : "Inactive" },
            { name: "Vote Until", value: row.vote_until ? `<t:${Math.floor(new Date(row.vote_until).getTime() / 1000)}:F>` : "Not set" },
            { name: "User Buy Premium", value: buyActive ? "Active" : "Inactive" },
            { name: "Prefix Access", value: (voteActive || buyActive) ? "Enabled" : "Disabled" },
            { name: "Saved Personal Prefix", value: row.custom_prefix || "Not set" }
        ];

        if (message.guildId) {
            const guildRow = await getGuildVoteRow(message.guildId).catch(() => null);
            const guildAny = isGuildAnyPremiumRowActive(guildRow);
            const guildPaid = isGuildPaidPremiumActive(guildRow);
            const st247 = await getGuild247Settings(message.guildId).catch(() => null);

            fields.push({ name: "Guild Premium", value: guildAny ? "Active" : "Inactive" });
            fields.push({
                name: "Guild Premium Type",
                value: guildPaid ? "Paid Token" : (guildAny ? "Vote" : "None")
            });
            fields.push({
                name: "Guild Theme",
                value: guildAny ? `\`${guildRow.musicard_theme || "ease"}\`` : "Default (`ease`)"
            });
            fields.push({ name: "24/7 Mode", value: st247?.enabled ? "ON" : "OFF" });

            if (guildPaid) {
                fields.push({
                    name: "Paid Until",
                    value: guildRow.premium_is_permanent
                        ? "Permanent"
                        : `<t:${Math.floor(new Date(guildRow.premium_until).getTime() / 1000)}:F>`
                });
            } else if (guildRow?.voter_user_id) {
                fields.push({ name: "Vote Controller", value: `<@${guildRow.voter_user_id}>` });
            }
        }

        await reply({
            title: "My Premium",
            description: "User prefix works with vote premium or buy premium. Guild musicard + 24/7 works with vote or paid token premium.",
            fields,
            footer: "Use premiumtoken / premiumredeem / 247"
        });
    }
};
