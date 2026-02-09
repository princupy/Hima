const { MessageFlags } = require("discord.js");
const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("./profile");
const { setPremiumUserPrefix, voteUrl, buyUrl } = require("./service");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
    name: "myprefix",
    aliases: ["userprefix"],
    description: "Set your personal prefix (vote premium or buy premium).",
    usage: "myprefix <1-5 chars>",
    async execute({ bot, message, args, reply }) {
        const voteActive = await isVotePremiumActive(message.author.id).catch(() => false);
        const paidActive = await hasUserPaidPremiumAccess(message.author.id).catch(() => false);
        const active = voteActive || paidActive;

        if (!active) {
            await message.reply({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Premium Required" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "Use vote premium or buy premium to unlock personal prefix." },
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

        const input = args[0];
        if (!input) {
            await reply({ title: "Missing Prefix", description: "Usage: myprefix <1-5 chars>" });
            return;
        }

        try {
            const value = await setPremiumUserPrefix(message.author.id, input);
            await reply({
                title: "Personal Prefix Updated",
                description: `Your prefix is now \`${value}\` (active while vote premium or buy premium is active).`
            });
        } catch (error) {
            await reply({ title: "Prefix Update Failed", description: String(error.message || error) });
        }
    }
};
