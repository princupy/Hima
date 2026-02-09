const { MessageFlags } = require("discord.js");
const { createPremiumToken, TOKEN_PLANS } = require("./service");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const SESSION_TTL_MS = 10 * 60 * 1000;
const sessions = new Map();

function now() {
    return Date.now();
}

function cleanSessions() {
    const t = now();
    for (const [k, v] of sessions) {
        if (v.expiresAt <= t) sessions.delete(k);
    }
}

function makeSessionId() {
    return Math.random().toString(36).slice(2, 10);
}

function durationOptions() {
    return TOKEN_PLANS.map((p) => ({
        label: p.label,
        value: p.key,
        description: `INR ${p.priceInr}${p.days ? ` • ${p.days} days` : " • Lifetime"}`
    }));
}

function plansText() {
    return TOKEN_PLANS
        .map((p, i) => `${i + 1}. ${p.label} - INR ${p.priceInr}`)
        .join("\n");
}

module.exports = {
    name: "premiumtoken",
    aliases: ["ptoken", "gptoken"],
    description: "Owner-only: generate redeem token for guild premium plans.",
    usage: "premiumtoken",

    async execute({ bot, message, reply }) {
        if (message.author.id !== bot.config.noPrefix.ownerId) {
            await reply({
                title: "Owner Only",
                description: "Only bot owner can generate premium tokens."
            });
            return;
        }

        cleanSessions();
        const sid = makeSessionId();
        sessions.set(sid, {
            ownerId: message.author.id,
            channelId: message.channelId,
            expiresAt: now() + SESSION_TTL_MS
        });

        await message.reply({
            flags: COMPONENTS_V2_FLAG,
            components: [
                {
                    type: 17,
                    components: [
                        { type: 10, content: "## Generate Premium Token" },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: "Select duration plan from dropdown." },
                        { type: 10, content: `**Plans (INR)**\n${plansText()}` },
                        {
                            type: 1,
                            components: [
                                {
                                    type: 3,
                                    custom_id: `ptok:${sid}`,
                                    placeholder: "Select premium duration",
                                    options: durationOptions()
                                }
                            ]
                        }
                    ]
                }
            ]
        });
    },

    async handleInteraction({ interaction }) {
        cleanSessions();

        if (!interaction.isStringSelectMenu()) return false;
        if (!interaction.customId.startsWith("ptok:")) return false;

        const sid = interaction.customId.split(":")[1];
        const sess = sessions.get(sid);
        if (!sess || sess.expiresAt <= now()) {
            sessions.delete(sid);
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Token Session Expired" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "Run premiumtoken command again." }
                        ]
                    }
                ]
            }).catch(() => null);
            return true;
        }

        if (interaction.user.id !== sess.ownerId) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const durationKey = interaction.values?.[0];
        if (!durationKey) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        try {
            const result = await createPremiumToken({ ownerId: interaction.user.id, durationKey });
            const plan = result.plan;
            const tokenCode = result.row.token;

            const dm = await interaction.user.createDM().catch(() => null);
            if (dm) {
                await dm.send({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## Premium Token Created" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: `**Token:** \`${tokenCode}\`` },
                                { type: 10, content: `**Plan:** ${plan.label}` },
                                { type: 10, content: `**Price:** INR ${plan.priceInr}` },
                                { type: 10, content: `Use: \`premiumredeem ${tokenCode}\` (server admin only)` }
                            ]
                        }
                    ]
                }).catch(() => null);
            }

            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Token Generated" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: `Plan: **${plan.label}**` },
                            { type: 10, content: `Price: **INR ${plan.priceInr}**` },
                            { type: 10, content: dm ? "Token sent in your DM." : `Token: \`${tokenCode}\`` }
                        ]
                    }
                ]
            }).catch(() => null);
        } catch (error) {
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Token Generation Failed" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: String(error.message || error) }
                        ]
                    }
                ]
            }).catch(() => null);
        }

        sessions.delete(sid);
        return true;
    }
};
