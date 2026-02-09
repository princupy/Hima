const fs = require("node:fs");
const path = require("node:path");
const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const BOTINFO_VIEW_TTL_MS = 20 * 60 * 1000;
const botInfoViews = new Map();

function createToken() {
    return Math.random().toString(36).slice(2, 10);
}

function cleanupViews() {
    const now = Date.now();
    for (const [token, view] of botInfoViews) {
        if (view.expiresAt <= now) botInfoViews.delete(token);
    }
}

function walkSourceStats(rootDir) {
    let files = 0;
    let folders = 0;

    function walk(dir, isRoot = false) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (!isRoot) folders += 1;

        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full, false);
            } else if (entry.isFile()) {
                files += 1;
            }
        }
    }

    if (fs.existsSync(rootDir)) {
        walk(rootDir, true);
    }

    return { files, folders };
}

function getRuntimeStats(bot) {
    const srcDir = path.resolve(__dirname, "..");
    const pkgPath = path.resolve(srcDir, "..", "package.json");

    let dependencyNames = [];
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            dependencyNames = Object.keys(pkg.dependencies || {});
        } catch {
            dependencyNames = [];
        }
    }

    const srcStats = walkSourceStats(srcDir);

    return {
        uptimeSec: Math.floor(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        guilds: bot.client.guilds.cache.size,
        users: bot.client.users.cache.size,
        pingMs: Math.max(0, Math.round(bot.client.ws.ping || 0)),
        dependencyNames,
        dependencyCount: dependencyNames.length,
        srcFolders: srcStats.folders,
        srcFiles: srcStats.files,
        updatedAt: `<t:${Math.floor(Date.now() / 1000)}:T>`
    };
}

function formatDuration(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
}

function buildControls(token, pageIndex) {
    return {
        type: 1,
        components: [
            {
                type: 2,
                style: 2,
                custom_id: `botinfo_nav:${token}:prev`,
                label: "Previous",
                disabled: pageIndex <= 0
            },
            {
                type: 2,
                style: 2,
                custom_id: `botinfo_nav:${token}:next`,
                label: "Next",
                disabled: pageIndex >= 2
            },
            {
                type: 2,
                style: 1,
                custom_id: `botinfo_nav:${token}:home`,
                label: "Home"
            },
            {
                type: 2,
                style: 3,
                custom_id: `botinfo_nav:${token}:refresh`,
                label: "Refresh"
            }
        ]
    };
}

function renderPage({ bot, token, pageIndex, ownerId }) {
    const botUser = bot.client.user;
    const avatarUrl = botUser?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;
    const stats = getRuntimeStats(bot);

    const ownerDiscordUrl = process.env.BOT_OWNER_ID
        ? `https://discord.com/users/${process.env.BOT_OWNER_ID}`
        : (process.env.DEVELOPER_DISCORD_URL || "https://discord.com");
    const ownerInstaUrl = process.env.DEVELOPER_INSTAGRAM_URL || "https://www.instagram.com/tanmoy_here8388/";
    const ownerLabel = process.env.DEVELOPER_NAME || "Prince";

    const pages = [
        {
            title: "## Bot Info",
            summary: `**Name:** ${botUser?.username || "Hima"}\n**Bot ID:** ${botUser?.id || "Unknown"}\n**Created:** ${botUser?.createdTimestamp ? `<t:${Math.floor(botUser.createdTimestamp / 1000)}:F>` : "Unknown"}\n**Guilds:** ${stats.guilds}\n**Users (cached):** ${stats.users}\n**Latency:** ${stats.pingMs}ms\n**Uptime:** ${formatDuration(stats.uptimeSec)}`,
            detail: "Page **1/3**\nUse Next for developer and technical pages."
        },
        {
            title: "## Developer",
            summary: `**Developer:** [${ownerLabel}](${ownerDiscordUrl})\n**Discord Profile:** [Open Profile](${ownerDiscordUrl})\n**Instagram:** [Open Instagram](${ownerInstaUrl})`,
            detail: `This bot is maintained by **${ownerLabel}**.\nPage **2/3**`
        },
        {
            title: "## Live Technical Stats",
            summary: `**Node.js:** ${process.version}\n**Memory (RSS):** ${stats.memoryMb} MB\n**Dependencies:** ${stats.dependencyCount}\n**Source Folders:** ${stats.srcFolders}\n**Source Files:** ${stats.srcFiles}\n**Updated:** ${stats.updatedAt}`,
            detail: `**Libraries**\n${stats.dependencyNames.map((x, i) => `${i + 1}. \`${x}\``).join("\n") || "No dependencies found."}\n\nPage **3/3**`
        }
    ];

    const page = pages[Math.min(Math.max(pageIndex, 0), pages.length - 1)];

    const children = [
        { type: 10, content: page.title },
        { type: 14, divider: true, spacing: 1 },
        {
            type: 9,
            components: [{ type: 10, content: page.summary }],
            ...(avatarUrl
                ? {
                    accessory: {
                        type: 11,
                        media: { url: avatarUrl }
                    }
                }
                : {})
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: page.detail },
        { type: 14, divider: true, spacing: 1 },
        buildControls(token, pageIndex),
        { type: 10, content: `Panel owner: <@${ownerId}>` }
    ];

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
                    { type: 10, content: "## Bot Info Panel Expired" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Run `botinfo` again." }
                ]
            }
        ]
    };
}

module.exports = {
    name: "botinfo",
    aliases: ["bi"],
    description: "Show detailed bot information with interactive pages.",
    usage: "botinfo",

    async execute({ bot, message }) {
        cleanupViews();

        const token = createToken();
        botInfoViews.set(token, {
            userId: message.author.id,
            page: 0,
            expiresAt: Date.now() + BOTINFO_VIEW_TTL_MS
        });

        await message.reply(renderPage({
            bot,
            token,
            pageIndex: 0,
            ownerId: message.author.id
        }));
    },

    async handleInteraction({ bot, interaction }) {
        cleanupViews();

        if (!interaction.isButton()) return false;
        if (!interaction.customId.startsWith("botinfo_nav:")) return false;

        const [, token, action] = interaction.customId.split(":");
        const view = botInfoViews.get(token);

        if (!view || view.expiresAt <= Date.now()) {
            botInfoViews.delete(token);
            await interaction.update(buildExpiredPayload()).catch(() => null);
            return true;
        }

        if (interaction.user.id !== view.userId) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        if (action === "home") view.page = 0;
        if (action === "prev") view.page -= 1;
        if (action === "next") view.page += 1;
        if (action === "refresh") view.page = view.page;

        view.page = Math.min(Math.max(view.page, 0), 2);
        view.expiresAt = Date.now() + BOTINFO_VIEW_TTL_MS;
        botInfoViews.set(token, view);

        await interaction.update(renderPage({
            bot,
            token,
            pageIndex: view.page,
            ownerId: view.userId
        })).catch(() => null);

        return true;
    }
};
