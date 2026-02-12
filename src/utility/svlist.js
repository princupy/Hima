const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const PAGE_SIZE = 5;
const VIEW_TTL_MS = 20 * 60 * 1000;
const views = new Map();

function createToken() {
    return Math.random().toString(36).slice(2, 10);
}

function isOwner(bot, userId) {
    return userId === bot?.config?.noPrefix?.ownerId || userId === process.env.BOT_OWNER_ID;
}

function cleanupViews() {
    const now = Date.now();
    for (const [token, view] of views.entries()) {
        if (view.expiresAt <= now) views.delete(token);
    }
}

function collectGuildRows(client) {
    const rows = Array.from(client.guilds.cache.values()).map((guild) => ({
        id: guild.id,
        name: guild.name,
        members: Number(guild.memberCount || 0),
        ownerId: guild.ownerId || "Unknown",
        createdAt: guild.createdTimestamp || null
    }));

    rows.sort((a, b) => b.members - a.members);
    return rows;
}

function buildRowText(row, index) {
    const created = row.createdAt ? `<t:${Math.floor(row.createdAt / 1000)}:R>` : "Unknown";
    return [
        `**${index}. ${row.name}**`,
        `ID: \`${row.id}\``,
        `Members: \`${row.members.toLocaleString("en-US")}\``,
        `Owner ID: \`${row.ownerId}\``,
        `Created: ${created}`
    ].join("\n");
}

function buildPagePayload({ rows, page, token, ownerId }) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);

    const start = clampedPage * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    const children = [
        { type: 10, content: "## Server List" },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `Total Servers: **${rows.length.toLocaleString("en-US")}**` },
        { type: 14, divider: true, spacing: 1 }
    ];

    if (!pageRows.length) {
        children.push({ type: 10, content: "No servers found." });
    } else {
        for (let i = 0; i < pageRows.length; i += 1) {
            const globalIndex = start + i + 1;
            children.push({ type: 10, content: buildRowText(pageRows[i], globalIndex) });
            children.push({ type: 14, divider: true, spacing: 1 });
        }
    }

    children.push({
        type: 1,
        components: [
            {
                type: 2,
                style: 2,
                custom_id: `svlist_nav:${token}:prev`,
                label: "Previous",
                disabled: clampedPage === 0
            },
            {
                type: 2,
                style: 2,
                custom_id: `svlist_nav:${token}:next`,
                label: "Next",
                disabled: clampedPage >= totalPages - 1
            }
        ]
    });

    children.push({ type: 10, content: `Page **${clampedPage + 1}/${totalPages}**` });
    children.push({ type: 10, content: `Panel owner: <@${ownerId}>` });

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [{ type: 17, components: children }]
    };
}

function buildExpiredPayload() {
    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## Server List Expired" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Run `svlist` again." }
                ]
            }
        ]
    };
}

module.exports = {
    name: "svlist",
    aliases: ["serverlist", "guildlist"],
    description: "Owner-only paginated list of all guilds where bot is present.",
    usage: "svlist",

    async execute({ bot, message, reply }) {
        cleanupViews();

        if (!isOwner(bot, message.author.id)) {
            await reply({ title: "Access Denied", description: "Only bot owner can use this command." });
            return;
        }

        const rows = collectGuildRows(bot.client);
        const token = createToken();

        views.set(token, {
            ownerId: message.author.id,
            rows,
            page: 0,
            expiresAt: Date.now() + VIEW_TTL_MS
        });

        await message.reply(buildPagePayload({
            rows,
            page: 0,
            token,
            ownerId: message.author.id
        }));
    },

    async handleInteraction({ interaction }) {
        cleanupViews();

        if (!interaction.isButton()) return false;
        if (!interaction.customId.startsWith("svlist_nav:")) return false;

        const [, token, direction] = interaction.customId.split(":");
        const view = views.get(token);

        if (!view || view.expiresAt <= Date.now()) {
            views.delete(token);
            await interaction.update(buildExpiredPayload()).catch(() => null);
            return true;
        }

        if (interaction.user.id !== view.ownerId) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const maxPage = Math.max(0, Math.ceil(view.rows.length / PAGE_SIZE) - 1);
        if (direction === "next") view.page += 1;
        if (direction === "prev") view.page -= 1;
        view.page = Math.min(Math.max(view.page, 0), maxPage);
        view.expiresAt = Date.now() + VIEW_TTL_MS;
        views.set(token, view);

        await interaction.update(buildPagePayload({
            rows: view.rows,
            page: view.page,
            token,
            ownerId: view.ownerId
        })).catch(() => null);

        return true;
    }
};
