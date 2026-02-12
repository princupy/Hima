const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const PANEL_TTL_MS = 10 * 60 * 1000;
const panels = new Map();

function createToken() {
    return Math.random().toString(36).slice(2, 10);
}

function cleanupPanels() {
    const now = Date.now();
    for (const [token, panel] of panels.entries()) {
        if (panel.expiresAt <= now) panels.delete(token);
    }
}

async function resolveTarget(message, raw) {
    const mention = message.mentions.users.first();
    if (mention) return mention;

    const id = String(raw || "").replace(/[^0-9]/g, "");
    if (id) {
        const fetched = await message.client.users.fetch(id).catch(() => null);
        if (fetched) return fetched;
    }

    return message.author;
}

function buildSelector(token) {
    return {
        type: 1,
        components: [
            {
                type: 3,
                custom_id: `banner_select:${token}`,
                placeholder: "Select Banner Type",
                options: [
                    {
                        label: "User Banner",
                        value: "user",
                        description: "Show global Discord profile banner"
                    },
                    {
                        label: "Server Banner",
                        value: "server",
                        description: "Show this server profile banner"
                    }
                ]
            }
        ]
    };
}

function buildPanelPayload({ token, ownerId, targetId, targetName, targetAvatar }) {
    const userLink = `https://discord.com/users/${targetId}`;

    const intro = targetAvatar
        ? {
            type: 9,
            components: [
                {
                    type: 10,
                    content: `**Target**\n[${targetName}](${userLink})\nID: ${targetId}`
                }
            ],
            accessory: {
                type: 11,
                media: { url: targetAvatar }
            }
        }
        : {
            type: 10,
            content: `**Target**\n[${targetName}](${userLink})\nID: ${targetId}`
        };

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## Banner Viewer" },
                    { type: 14, divider: true, spacing: 1 },
                    intro,
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Choose what you want to view from dropdown." },
                    buildSelector(token),
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: `Only <@${ownerId}> can use this panel.` }
                ]
            }
        ]
    };
}

function buildExpiredPayload() {
    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## Banner Panel Expired" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Run banner command again." }
                ]
            }
        ]
    };
}

function buildResultPayload({
    token,
    ownerId,
    targetId,
    targetName,
    targetAvatar,
    mode,
    bannerUrl,
    messageText
}) {
    const userLink = `https://discord.com/users/${targetId}`;
    const modeTitle = mode === "server" ? "Server Banner" : "User Banner";

    const intro = targetAvatar
        ? {
            type: 9,
            components: [
                {
                    type: 10,
                    content: `**Target**\n[${targetName}](${userLink})\nID: ${targetId}`
                }
            ],
            accessory: {
                type: 11,
                media: { url: targetAvatar }
            }
        }
        : {
            type: 10,
            content: `**Target**\n[${targetName}](${userLink})\nID: ${targetId}`
        };

    const children = [
        { type: 10, content: "## Banner Viewer" },
        { type: 14, divider: true, spacing: 1 },
        intro,
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `**Type**\n${modeTitle}` },
        { type: 10, content: messageText },
        ...(bannerUrl
            ? [
                { type: 12, items: [{ media: { url: bannerUrl } }] },
                { type: 10, content: `[Open Banner](${bannerUrl})` }
            ]
            : []),
        { type: 14, divider: true, spacing: 1 },
        buildSelector(token),
        { type: 10, content: `Only <@${ownerId}> can use this panel.` }
    ];

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [{ type: 17, components: children }]
    };
}

module.exports = {
    name: "banner",
    aliases: ["bnr", "profilebanner"],
    description: "Show user banner or server banner with dropdown selection.",
    usage: "banner [@user|id]",

    async execute({ message, args, reply }) {
        cleanupPanels();

        const target = await resolveTarget(message, args[0]);
        const token = createToken();
        const targetAvatar = target.displayAvatarURL({ extension: "png", size: 1024 });

        panels.set(token, {
            ownerId: message.author.id,
            guildId: message.guild.id,
            targetId: target.id,
            expiresAt: Date.now() + PANEL_TTL_MS
        });

        const payload = buildPanelPayload({
            token,
            ownerId: message.author.id,
            targetId: target.id,
            targetName: target.username,
            targetAvatar
        });

        await message.reply(payload).catch(async () => {
            await reply({
                title: "Banner Viewer",
                description: "Choose banner type from dropdown (User Banner / Server Banner).",
                fields: [
                    { name: "Target", value: `<@${target.id}>` },
                    { name: "Tip", value: "Use command again if panel expires." }
                ],
                image: targetAvatar
            });
        });
    },

    async handleInteraction({ bot, interaction }) {
        if (!interaction.isStringSelectMenu()) return false;
        if (!interaction.customId.startsWith("banner_select:")) return false;

        cleanupPanels();

        const [, token] = interaction.customId.split(":");
        const panel = panels.get(token);

        if (!panel || panel.expiresAt <= Date.now()) {
            panels.delete(token);
            await interaction.update(buildExpiredPayload()).catch(() => null);
            return true;
        }

        if (interaction.user.id !== panel.ownerId) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const mode = interaction.values?.[0];
        if (mode !== "user" && mode !== "server") {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const target = await bot.client.users.fetch(panel.targetId, { force: true }).catch(() => null);
        if (!target) {
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Banner Viewer" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "Unable to fetch target user now." }
                        ]
                    }
                ]
            }).catch(() => null);
            return true;
        }

        let bannerUrl = null;
        let messageText = "";

        if (mode === "user") {
            bannerUrl = target.bannerURL({ extension: "png", size: 4096 });
            messageText = bannerUrl
                ? "Global profile banner found."
                : "No global user banner set for this user.";
        } else {
            const guild = await bot.client.guilds.fetch(panel.guildId).catch(() => null);
            const member = guild
                ? await guild.members.fetch(target.id).catch(() => null)
                : null;

            bannerUrl = member?.bannerURL?.({ extension: "png", size: 4096 }) || null;
            messageText = bannerUrl
                ? "Server profile banner found."
                : "No server banner set for this user in this server.";
        }

        panel.expiresAt = Date.now() + PANEL_TTL_MS;
        panels.set(token, panel);

        await interaction.update(buildResultPayload({
            token,
            ownerId: panel.ownerId,
            targetId: target.id,
            targetName: target.username,
            targetAvatar: target.displayAvatarURL({ extension: "png", size: 1024 }),
            mode,
            bannerUrl,
            messageText
        })).catch(() => null);

        return true;
    }
};