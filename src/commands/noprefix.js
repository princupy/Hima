const { MessageFlags } = require("discord.js");
const { buildContainerMessage } = require("../components/containerBuilder");
const {
    parseDurationValue,
    setNoPrefixUser,
    removeNoPrefixUser,
    getNoPrefixRow,
    getActiveNoPrefixUsers
} = require("../database/noPrefix");
const { sendNoPrefixLog, formatExpiry } = require("../services/noPrefixService");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const LIST_PAGE_SIZE = 4;
const LIST_VIEW_TTL_MS = 15 * 60 * 1000;
const READD_VIEW_TTL_MS = 10 * 60 * 1000;

const listViews = new Map();
const readdViews = new Map();

const DURATION_OPTIONS = [
    { label: "30 Minutes", value: String(30 * 60 * 1000), description: "Expires in 30 minutes" },
    { label: "1 Week", value: String(7 * 24 * 60 * 60 * 1000), description: "Expires in 7 days" },
    { label: "1 Month", value: String(30 * 24 * 60 * 60 * 1000), description: "Expires in 30 days" },
    { label: "3 Months", value: String(90 * 24 * 60 * 60 * 1000), description: "Expires in 90 days" },
    { label: "6 Months", value: String(180 * 24 * 60 * 60 * 1000), description: "Expires in 180 days" },
    { label: "1 Year", value: String(365 * 24 * 60 * 60 * 1000), description: "Expires in 365 days" },
    { label: "Permanent", value: "permanent", description: "No expiry" }
];

function isOwner(bot, userId) {
    return userId === bot.config.noPrefix.ownerId;
}

function parseUserId(raw) {
    if (!raw) return null;
    const mention = raw.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];
    const plain = raw.match(/^(\d{16,22})$/);
    if (plain) return plain[1];
    return null;
}

function createToken() {
    return Math.random().toString(36).slice(2, 10);
}

function cleanupListViews() {
    const now = Date.now();
    for (const [token, value] of listViews) {
        if (value.expiresAt <= now) listViews.delete(token);
    }
}

function cleanupReaddViews() {
    const now = Date.now();
    for (const [token, value] of readdViews) {
        if (value.expiresAt <= now) readdViews.delete(token);
    }
}

function buildDurationPickerPayload(mode, token, targetUserId) {
    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## No Prefix Duration" },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 10,
                        content: mode === "extend"
                            ? `Select extra duration for <@${targetUserId}>.`
                            : `Choose duration for <@${targetUserId}>.`
                    },
                    {
                        type: 1,
                        components: [
                            {
                                type: 3,
                                custom_id: `noprefix_duration:${token}`,
                                placeholder: "Select no-prefix duration",
                                options: DURATION_OPTIONS,
                                min_values: 1,
                                max_values: 1
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

function buildReAddWarningPayload(token, targetUserId, expiresAt) {
    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## Already Active" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: `<@${targetUserId}> already has no-prefix enabled.` },
                    { type: 10, content: `Current Expiry: ${formatExpiry(expiresAt)}` },
                    { type: 10, content: "Continue will add selected duration on top of remaining time." },
                    {
                        type: 1,
                        components: [
                            {
                                type: 2,
                                style: 1,
                                custom_id: `noprefix_readd_continue:${token}`,
                                label: "Continue"
                            },
                            {
                                type: 2,
                                style: 2,
                                custom_id: `noprefix_readd_cancel:${token}`,
                                label: "Cancel"
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

function rowToField(row) {
    return {
        name: `<@${row.user_id}>`,
        value: `Expiry: ${formatExpiry(row.expires_at)}\nAdded by: <@${row.added_by || "unknown"}>`
    };
}

function getDurationLabelFromValue(value) {
    const found = DURATION_OPTIONS.find((opt) => opt.value === value);
    return found?.label || "Custom";
}

function getTierLabel(expiresAt) {
    return expiresAt ? "TIME-LIMITED" : "LIFETIME";
}

function displayUsername(user, fallbackId) {
    return user?.username || `Unknown (${fallbackId})`;
}

function displayUsernameClickable(user, fallbackId) {
    const rawId = user?.id || fallbackId;
    const id = /^\d{16,22}$/.test(String(rawId || "")) ? String(rawId) : "";
    const label = user?.username || `Unknown (${fallbackId})`;
    return id ? `[${label}](https://discord.com/users/${id})` : label;
}

function userAvatar(user) {
    return user?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;
}

function buildNoPrefixCard({
    title,
    targetUser,
    targetUserId,
    addedByUser,
    addedById,
    expiresAt,
    durationLabel,
    footer,
    includeImage = true
}) {
    return buildContainerMessage({
        title,
        description: "Detailed no-prefix access card",
        fields: [
            {
                name: "User",
                value: `${displayUsernameClickable(targetUser, targetUserId)}\nUser Mention: <@${targetUserId}>\nID: ${targetUserId}`
            },
            {
                name: "Added By",
                value: `${displayUsername(addedByUser, addedById)}\nMention: <@${addedById}>`
            },
            {
                name: "Expiry",
                value: `Expiry Time: ${expiresAt ? formatExpiry(expiresAt) : "Lifetime"}\nDuration: ${durationLabel || (expiresAt ? "Custom" : "Permanent")}`
            },
            {
                name: "Tier",
                value: `**${getTierLabel(expiresAt)}**`
            }
        ],
        image: includeImage ? userAvatar(targetUser) : undefined,
        footer
    });
}

function formatRelativeTime(ms) {
    if (!ms) return "Unknown";
    return `<t:${Math.floor(ms / 1000)}:R>`;
}

function buildUserListSection(item) {
    const detailLines = [`Account Created: ${formatRelativeTime(item.createdAt)}`];
    if (item.joinedAt) detailLines.push(`Joined Server: ${formatRelativeTime(item.joinedAt)}`);

    const section = {
        type: 9,
        components: [
            {
                type: 10,
                content: `**${item.globalIndex}. [${item.username}](${item.profileUrl})**\n${detailLines.join("\n")}`
            }
        ]
    };

    if (item.avatar) {
        section.accessory = {
            type: 11,
            media: { url: item.avatar }
        };
    }

    return section;
}

async function buildListPagePayload({ bot, guild, rows, page, token }) {
    const totalPages = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
    const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);

    const start = clampedPage * LIST_PAGE_SIZE;
    const end = start + LIST_PAGE_SIZE;
    const pageRows = rows.slice(start, end);

    const items = await Promise.all(pageRows.map(async (row, idx) => {
        const [user, member] = await Promise.all([
            bot.client.users.fetch(row.user_id).catch(() => null),
            guild.members.fetch(row.user_id).catch(() => null)
        ]);

        const globalIndex = start + idx + 1;
        const username = user?.username || row.user_id;
        const profileUrl = `https://discord.com/users/${row.user_id}`;

        return {
            globalIndex,
            username,
            profileUrl,
            createdAt: user?.createdTimestamp || null,
            joinedAt: member?.joinedTimestamp || null,
            avatar: userAvatar(user)
        };
    }));

    const children = [
        { type: 10, content: "## No-Prefix Users" },
        { type: 14, divider: true, spacing: 1 }
    ];

    if (!items.length) {
        children.push({ type: 10, content: "No active no-prefix users." });
    } else {
        for (const item of items) {
            children.push(buildUserListSection(item));
            children.push({ type: 14, divider: true, spacing: 1 });
        }
    }

    children.push({
        type: 1,
        components: [
            {
                type: 2,
                style: 2,
                custom_id: `noprefix_list:${token}:prev`,
                label: "Previous",
                disabled: clampedPage === 0
            },
            {
                type: 2,
                style: 2,
                custom_id: `noprefix_list:${token}:next`,
                label: "Next",
                disabled: clampedPage >= totalPages - 1
            }
        ]
    });

    children.push({
        type: 10,
        content: `Page **${clampedPage + 1}/${totalPages}** - **${rows.length}** total users`
    });

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [{ type: 17, components: children }]
    };
}

module.exports = {
    name: "noprefix",
    aliases: ["npx"],
    description: "Owner-only no-prefix manager.",
    usage: "noprefix <add|remove|list|status> ...",

    async execute({ bot, message, args, reply }) {
        if (!isOwner(bot, message.author.id)) {
            await reply({ title: "Access Denied", description: "Only bot owner can use this command." });
            return;
        }

        cleanupReaddViews();
        const action = (args[0] || "").toLowerCase();

        if (action === "add") {
            const userId = parseUserId(args[1]);
            if (!userId) {
                await reply({ title: "Invalid User", description: "Usage: noprefix add <@user|userId>" });
                return;
            }

            const existing = await getNoPrefixRow(userId).catch(() => null);
            if (existing?.is_active) {
                if (!existing.expires_at) {
                    await reply({
                        title: "Already Permanent",
                        description: `<@${userId}> already has permanent no-prefix enabled.`
                    });
                    return;
                }

                const token = createToken();
                readdViews.set(token, {
                    ownerId: message.author.id,
                    targetUserId: userId,
                    guildId: message.guild.id,
                    channelId: message.channel.id,
                    mode: "extend",
                    expiresAt: Date.now() + READD_VIEW_TTL_MS
                });

                await message.reply(buildReAddWarningPayload(token, userId, existing.expires_at));
                return;
            }

            const token = createToken();
            readdViews.set(token, {
                ownerId: message.author.id,
                targetUserId: userId,
                guildId: message.guild.id,
                channelId: message.channel.id,
                mode: "new",
                expiresAt: Date.now() + READD_VIEW_TTL_MS
            });

            await message.reply(buildDurationPickerPayload("new", token, userId));
            return;
        }

        if (action === "remove") {
            const userId = parseUserId(args[1]);
            if (!userId) {
                await reply({ title: "Invalid User", description: "Usage: noprefix remove <@user|userId>" });
                return;
            }

            const removed = await removeNoPrefixUser(userId, message.author.id).catch((err) => {
                throw new Error(`No-prefix remove failed: ${err.message || err}`);
            });

            if (!removed) {
                await reply({ title: "Not Active", description: "User does not have active no-prefix." });
                return;
            }

            await sendNoPrefixLog(bot, {
                title: "No Prefix Removed",
                description: `Removed no-prefix for <@${userId}>.`,
                sections: [{ title: "By", content: `<@${message.author.id}>` }]
            });

            await reply({ title: "Removed", description: `No-prefix removed for <@${userId}>.` });
            return;
        }

        if (action === "list") {
            cleanupListViews();
            const list = await getActiveNoPrefixUsers(500).catch((err) => {
                throw new Error(`No-prefix list failed: ${err.message || err}`);
            });

            if (!list.length) {
                await reply({ title: "No Prefix List", description: "No active no-prefix users." });
                return;
            }

            const token = createToken();
            listViews.set(token, {
                ownerId: message.author.id,
                guildId: message.guild.id,
                rows: list,
                page: 0,
                expiresAt: Date.now() + LIST_VIEW_TTL_MS
            });

            const payload = await buildListPagePayload({
                bot,
                guild: message.guild,
                rows: list,
                page: 0,
                token
            });

            await message.reply(payload);
            return;
        }

        if (action === "status") {
            const userId = parseUserId(args[1]) || message.author.id;
            const row = await getNoPrefixRow(userId).catch((err) => {
                throw new Error(`No-prefix status failed: ${err.message || err}`);
            });

            if (!row || !row.is_active) {
                await reply({ title: "No Prefix Status", description: `<@${userId}> is not active.` });
                return;
            }

            const [targetUser, addedByUser] = await Promise.all([
                bot.client.users.fetch(row.user_id).catch(() => null),
                row.added_by ? bot.client.users.fetch(row.added_by).catch(() => null) : Promise.resolve(null)
            ]);

            await message.reply(buildNoPrefixCard({
                title: "No Prefix Status",
                targetUser,
                targetUserId: row.user_id,
                addedByUser,
                addedById: row.added_by || "Unknown",
                expiresAt: row.expires_at,
                durationLabel: row.expires_at ? "Active Term" : "Permanent",
                footer: "Hima No-Prefix System"
            }));
            return;
        }

        await reply({
            title: "No Prefix Commands",
            description: "Use one of the owner-only subcommands.",
            fields: [
                { name: "Add", value: "noprefix add <@user|id>" },
                { name: "Remove", value: "noprefix remove <@user|id>" },
                { name: "List", value: "noprefix list" },
                { name: "Status", value: "noprefix status <@user|id>" }
            ]
        });
    },

    async handleInteraction({ bot, interaction }) {
        cleanupReaddViews();

        if (interaction.isButton() && interaction.customId.startsWith("noprefix_readd_")) {
            const [action, token] = interaction.customId.split(":");
            const state = readdViews.get(token);

            if (!state || state.expiresAt <= Date.now()) {
                readdViews.delete(token);
                await interaction.update({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## Request Expired" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "Run the add command again." }
                            ]
                        }
                    ]
                }).catch(() => null);
                return true;
            }

            if (!isOwner(bot, interaction.user.id) || interaction.user.id !== state.ownerId) {
                await interaction.deferUpdate().catch(() => null);
                return true;
            }

            if (action === "noprefix_readd_cancel") {
                readdViews.delete(token);
                await interaction.update({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## Cancelled" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "No changes were made." }
                            ]
                        }
                    ]
                }).catch(() => null);
                return true;
            }

            state.mode = "extend";
            state.expiresAt = Date.now() + READD_VIEW_TTL_MS;
            readdViews.set(token, state);
            await interaction.update(buildDurationPickerPayload("extend", token, state.targetUserId)).catch(() => null);
            return true;
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("noprefix_duration:")) {
            const [, token] = interaction.customId.split(":");
            const state = readdViews.get(token);

            if (!state || state.expiresAt <= Date.now()) {
                readdViews.delete(token);
                await interaction.update({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## Request Expired" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "Run the add command again." }
                            ]
                        }
                    ]
                }).catch(() => null);
                return true;
            }

            if (!isOwner(bot, interaction.user.id) || interaction.user.id !== state.ownerId) {
                await interaction.reply({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## Access Denied" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "Only command owner can select duration." }
                            ]
                        }
                    ]
                }).catch(() => null);
                return true;
            }

            const mode = state.mode || "new";
            const userId = state.targetUserId;
            const value = interaction.values?.[0] || "permanent";
            const selectedMs = parseDurationValue(value);

            let finalDurationMs = selectedMs;
            if (mode === "extend") {
                const existing = await getNoPrefixRow(userId).catch(() => null);

                if (!existing?.is_active) {
                    readdViews.delete(token);
                    await interaction.update({
                        flags: COMPONENTS_V2_FLAG,
                        components: [
                            {
                                type: 17,
                                components: [
                                    { type: 10, content: "## Re-Add Failed" },
                                    { type: 14, divider: true, spacing: 1 },
                                    { type: 10, content: "User is not active anymore. Run add again." }
                                ]
                            }
                        ]
                    }).catch(() => null);
                    return true;
                }

                if (!existing.expires_at) {
                    readdViews.delete(token);
                    await interaction.update({
                        flags: COMPONENTS_V2_FLAG,
                        components: [
                            {
                                type: 17,
                                components: [
                                    { type: 10, content: "## Already Permanent" },
                                    { type: 14, divider: true, spacing: 1 },
                                    { type: 10, content: `<@${userId}> already has permanent no-prefix.` }
                                ]
                            }
                        ]
                    }).catch(() => null);
                    return true;
                }

                if (selectedMs === null) {
                    finalDurationMs = null;
                } else {
                    const remaining = Math.max(0, new Date(existing.expires_at).getTime() - Date.now());
                    finalDurationMs = remaining + selectedMs;
                }
            }

            const saved = await setNoPrefixUser({
                userId,
                addedBy: interaction.user.id,
                addedGuildId: state.guildId,
                addedChannelId: state.channelId,
                durationMs: finalDurationMs
            }).catch(async (err) => {
                await interaction.update({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## No Prefix Error" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: String(err.message || err) }
                            ]
                        }
                    ]
                }).catch(() => null);
                return null;
            });

            if (!saved) return true;

            readdViews.delete(token);

            await sendNoPrefixLog(bot, {
                title: mode === "extend" ? "No Prefix Extended" : "No Prefix Added",
                description: `${mode === "extend" ? "Extended" : "Added"} no-prefix for <@${saved.user_id}>.`,
                sections: [
                    { title: "By", content: `<@${interaction.user.id}>` },
                    { title: "Expiry", content: formatExpiry(saved.expires_at) }
                ]
            });

            const targetUser = await interaction.client.users.fetch(saved.user_id).catch(() => null);

            await interaction.update(buildNoPrefixCard({
                title: mode === "extend" ? "No Prefix Extended" : "User Added To No Prefix",
                targetUser,
                targetUserId: saved.user_id,
                addedByUser: interaction.user,
                addedById: interaction.user.id,
                expiresAt: saved.expires_at,
                durationLabel: getDurationLabelFromValue(value),
                footer: mode === "extend" ? "No-prefix duration updated" : "No-prefix granted successfully",
                includeImage: false
            })).catch(() => null);

            return true;
        }

        if (interaction.isButton() && interaction.customId.startsWith("noprefix_list:")) {
            cleanupListViews();

            const [, token, dir] = interaction.customId.split(":");
            const view = listViews.get(token);

            if (!view || view.expiresAt <= Date.now()) {
                listViews.delete(token);
                await interaction.update({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## No-Prefix Users" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "This list panel expired. Run the command again." }
                            ]
                        }
                    ]
                }).catch(() => null);
                return true;
            }

            if (interaction.user.id !== view.ownerId) {
                await interaction.deferUpdate().catch(() => null);
                return true;
            }

            let nextPage = view.page;
            if (dir === "next") nextPage += 1;
            if (dir === "prev") nextPage -= 1;
            const maxPage = Math.max(0, Math.ceil(view.rows.length / LIST_PAGE_SIZE) - 1);
            nextPage = Math.min(Math.max(nextPage, 0), maxPage);

            view.page = nextPage;
            view.expiresAt = Date.now() + LIST_VIEW_TTL_MS;
            listViews.set(token, view);

            const guild = await bot.client.guilds.fetch(view.guildId).catch(() => null);
            if (!guild) {
                await interaction.update({
                    flags: COMPONENTS_V2_FLAG,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## No-Prefix Users" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "Guild is not available anymore." }
                            ]
                        }
                    ]
                }).catch(() => null);
                return true;
            }

            const payload = await buildListPagePayload({
                bot,
                guild,
                rows: view.rows,
                page: nextPage,
                token
            });

            await interaction.update(payload).catch(() => null);
            return true;
        }

        return false;
    }
};
