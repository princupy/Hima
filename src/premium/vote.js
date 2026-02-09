const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { syncVotePremium, voteUrl, buyUrl } = require("./service");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

function buildVoteButtons(bot) {
    return {
        type: 1,
        components: [
            {
                type: 2,
                style: 5,
                label: "Vote Premium",
                url: voteUrl(bot)
            },
            {
                type: 2,
                style: 5,
                label: "Buy Premium",
                url: buyUrl()
            }
        ]
    };
}

module.exports = {
    name: "vote",
    aliases: ["votecheck"],
    description: "Sync Top.gg vote for user prefix and guild musicard access.",
    usage: "vote",
    async execute({ bot, message, reply }) {
        try {
            const member = message.guild?.members?.cache?.get(message.author.id)
                || (message.guild ? await message.guild.members.fetch(message.author.id).catch(() => null) : null);
            const canManageGuild = Boolean(
                member?.permissions?.has(PermissionFlagsBits.ManageGuild)
            );

            const result = await syncVotePremium(bot, {
                userId: message.author.id,
                guildId: message.guildId || null,
                canManageGuild
            });

            if (!result.voted) {
                await message.reply({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## Vote Not Found" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "No recent Top.gg vote found for your account." },
                                { type: 10, content: "Vote now to unlock personal prefix. Guild musicard access needs admin vote in server." },
                                buildVoteButtons(bot)
                            ]
                        }
                    ]
                });
                return;
            }

            const fields = [
                { name: "User Premium", value: `Active until <t:${Math.floor(new Date(result.userUntil).getTime() / 1000)}:F>` },
                { name: "Unlocked", value: "Personal custom prefix" }
            ];

            if (message.guildId && canManageGuild) {
                fields.push({
                    name: "Guild Premium",
                    value: result.guildUntil
                        ? `Active until <t:${Math.floor(new Date(result.guildUntil).getTime() / 1000)}:F>`
                        : "Not active"
                });
                fields.push({
                    name: "Guild Musicard",
                    value: `Theme: \`${result.guildTheme || "ease"}\`\nUse \`musicard <theme>\` to change.`
                });
            } else if (message.guildId) {
                fields.push({
                    name: "Guild Musicard",
                    value: "Need `Manage Server` permission to activate guild vote premium here."
                });
            }

            await reply({
                title: "Vote Premium Activated",
                description: "Your vote has been synced successfully.",
                fields,
                footer: "Vote renews every 12 hours on Top.gg"
            });
        } catch (error) {
            await reply({
                title: "Vote Check Failed",
                description: String(error.message || error)
            });
        }
    }
};
