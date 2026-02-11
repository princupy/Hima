const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const HELP_VIEW_TTL_MS = 20 * 60 * 1000;
const COMMANDS_PER_PAGE = 5;
const helpViews = new Map();

const FILTER_HELP_ITEMS = [
    { name: "filter list", usage: "filter list", aliases: ["fx list", "filters list"], description: "Show all available filter presets and current active filter." },
    { name: "filter off", usage: "filter off", aliases: ["filter reset", "filter clear"], description: "Disable all active filters and return to normal sound." },
    { name: "filter bassboost", usage: "filter bassboost", aliases: [], description: "Boost low frequencies for punchy bass." },
    { name: "filter vaporwave", usage: "filter vaporwave", aliases: [], description: "Slower dreamy tuning with detuned feel." },
    { name: "filter nightcore", usage: "filter nightcore", aliases: [], description: "Faster playback with higher pitch." },
    { name: "filter soft", usage: "filter soft", aliases: [], description: "Warm and smooth listening profile." },
    { name: "filter karaoke", usage: "filter karaoke", aliases: [], description: "Reduce center vocal frequencies." },
    { name: "filter treble", usage: "filter treble", aliases: [], description: "Enhance high frequencies and clarity." },
    { name: "filter 8d", usage: "filter 8d", aliases: [], description: "Apply rotating headphone-style stereo effect." },
    { name: "filter tremolo", usage: "filter tremolo", aliases: [], description: "Apply rhythmic volume wobble." },
    { name: "filter vibrato", usage: "filter vibrato", aliases: [], description: "Apply pitch wobble effect." },
    { name: "filter chipmunk", usage: "filter chipmunk", aliases: [], description: "Very high-pitch voice tuning." },
    { name: "filter slowed", usage: "filter slowed", aliases: [], description: "Slow and relaxed playback feel." },
    { name: "filter distorted", usage: "filter distorted", aliases: [], description: "Heavy rough distorted effect." },
    { name: "filter earrape", usage: "filter earrape", aliases: [], description: "Very loud aggressive EQ profile." },
    { name: "filter radio", usage: "filter radio", aliases: [], description: "Telephone/radio narrow-band effect." }
];

const FAVORITE_HELP_ITEMS = [
    { name: "favorite add", usage: "favorite add [query/url]", aliases: ["fav add"], description: "Save current playing song or provided query to favorites." },
    { name: "favorite list", usage: "favorite list", aliases: ["fav list", "favs"], description: "Show your saved favorites list." },
    { name: "favorite play", usage: "favorite play <index>", aliases: ["fav play"], description: "Play a favorite song directly by index." },
    { name: "favorite play all", usage: "favorite play all", aliases: [], description: "Queue all favorite songs in index order." },
    { name: "favorite addqueue", usage: "favorite addqueue", aliases: ["favorite queueadd"], description: "Save current queue tracks into favorites." },
    { name: "favorite remove", usage: "favorite remove <index>", aliases: ["fav remove", "favorite delete"], description: "Remove a song from favorites by index." }
];

const PLAYLIST_HELP_ITEMS = [
    { name: "playlist create", usage: "playlist create [user|shared] <name>", aliases: [], description: "Create a cloud playlist." },
    { name: "playlist list", usage: "playlist list [user|shared]", aliases: [], description: "List your user/shared playlists." },
    { name: "playlist view", usage: "playlist view [user|shared] <name>", aliases: [], description: "Show tracks in a playlist." },
    { name: "playlist add", usage: "playlist add [user|shared] <name> <query/url|playlistId>", aliases: [], description: "Save a track into playlist or merge from shared playlist ID." },
    { name: "playlist addqueue", usage: "playlist addqueue [user|shared] <name>", aliases: ["playlist queueadd"], description: "Save full queue directly into a playlist." },
    { name: "playlist remove", usage: "playlist remove [user|shared] <name> <index>", aliases: [], description: "Remove one track by index." },
    { name: "playlist clear", usage: "playlist clear [user|shared] <name>", aliases: [], description: "Remove all tracks from playlist." },
    { name: "playlist delete", usage: "playlist delete [user|shared] <name>", aliases: [], description: "Delete a playlist permanently." },
    { name: "playlist load", usage: "playlist load [user|shared] <name>", aliases: [], description: "Load saved playlist into queue." },
    { name: "playlist export", usage: "playlist export [user|shared] <name>", aliases: [], description: "Export playlist as JSON file." },
    { name: "playlist share", usage: "playlist share [user|shared] <name>", aliases: [], description: "Generate shareable playlist ID." },
    { name: "playlist import", usage: "playlist import [user|shared] <name> <playlistId|json|url>", aliases: [], description: "Import from shared playlist ID or JSON text/file/url." },
    { name: "playlist autosync", usage: "playlist autosync <on|off> [playlistName]", aliases: [], description: "Auto-save songs played by you." },
    { name: "playlist autoload", usage: "playlist autoload <name|off>", aliases: ["playlist default"], description: "Auto-load default playlist on VC join." }
];

const CATEGORY_GROUPS = {
    main: {
        key: "main",
        label: "__Main Commands__",
        description: "Music-focused systems"
    },
    side: {
        key: "side",
        label: "__Extra Commands__",
        description: "Management and utility systems"
    }
};

const CATEGORIES = [
    {
        key: "music",
        label: "Music",
        group: "main",
        description: "Playback, queue and voice control commands.",
        commands: ["play", "pause", "resume", "skip", "stop", "disconnect", "queue", "nowplaying", "volume", "loop", "lyrics", "autoplay"]
    },
    {
        key: "filters",
        label: "Filters",
        group: "main",
        description: "Audio filter presets and realtime effects.",
        commands: ["filter"]
    },
    {
        key: "spotify",
        label: "Spotify",
        group: "main",
        description: "Connect your Spotify profile, list playlists and play directly.",
        commands: ["spconnect", "spstatus", "spplaylists", "spplay", "spdisconnect"]
    },
    {
        key: "favorites",
        label: "Favorites",
        group: "main",
        description: "Premium personal favorites list and quick playback.",
        commands: ["favorite"]
    },
    {
        key: "playlists",
        label: "Playlists",
        group: "main",
        description: "Premium cloud playlists with autosync, import/export and autoload.",
        commands: ["playlist"]
    },
    {
        key: "premium",
        label: "Premium",
        group: "main",
        description: "Premium system: vote or buy access, musicard and prefix controls.",
        commands: ["vote", "mypremium", "myprefix", "mycard", "247", "premiumtoken", "premiumredeem"]
    },
    {
        key: "general",
        label: "General",
        group: "side",
        description: "Profile and AFK convenience commands.",
        commands: ["avatar", "afk", "membercount"]
    },
    {
        key: "settings",
        label: "Settings",
        group: "side",
        description: "Guild configuration commands.",
        commands: ["prefix", "musicchannel", "config"]
    },
    {
        key: "utility",
        label: "Utility",
        group: "side",
        description: "General utility and bot info.",
        commands: ["help", "ping", "stats", "uptime", "botinfo", "serverstats", "voiceinfo", "shardinfo", "system", "support", "invite"]
    }
];

function cleanupViews() {
    const now = Date.now();
    for (const [token, value] of helpViews) {
        if (value.expiresAt <= now) helpViews.delete(token);
    }
}

function createToken() {
    return Math.random().toString(36).slice(2, 10);
}

function getCategory(key) {
    return CATEGORIES.find((x) => x.key === key) || CATEGORIES[0];
}

function listCategoriesByGroup(groupKey) {
    return CATEGORIES.filter((x) => x.group === groupKey);
}

function listCategoryOptions(groupKey) {
    return listCategoriesByGroup(groupKey).map((c) => ({
        label: c.label,
        value: c.key,
        description: c.description
    }));
}

function renderCategoryList(groupKey) {
    return listCategoriesByGroup(groupKey).map((x, i) => `> ${i + 1}. ${x.label}`).join("\n");
}

function getExistingCommands(bot, names) {
    return names.map((name) => bot.commandMap.get(name)).filter(Boolean);
}

function getCategoryEntries(bot, category) {
    if (category.key === "playlists") return PLAYLIST_HELP_ITEMS;
    if (category.key === "filters") return FILTER_HELP_ITEMS;
    if (category.key === "favorites") return FAVORITE_HELP_ITEMS;
    return getExistingCommands(bot, category.commands);
}

function getLiveTotalCommands(bot) {
    return new Set((bot.commands || []).map((c) => c.name)).size;
}

function formatCommandDetail(command, prefix, number) {
    const usage = `${prefix}${command.usage || command.name}`;
    const aliasText = (command.aliases && command.aliases.length)
        ? command.aliases.map((a) => `\`${a}\``).join(", ")
        : "None";

    return {
        title: `${number}. ${command.name}`,
        content: `Usage: \`${usage}\`\nAliases: ${aliasText}\nDetails: ${command.description || "No description"}`
    };
}

function buildHomePayload({ bot, prefix, token, selectedBy }) {
    const totalCommands = getLiveTotalCommands(bot);
    const avatarUrl = bot.client.user?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;

    const children = [
        { type: 10, content: "## Hima Help" },
        { type: 14, divider: true, spacing: 1 },
        {
            type: 9,
            components: [
                {
                    type: 10,
                    content: "**Hima** is a fast music bot with Lavalink playback, premium music cards, realtime filters, queue controls, and per-guild prefix/no-prefix systems."
                }
            ],
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
        { type: 10, content: `**Prefix:** \`${prefix}\`\n**Total Commands:** ${totalCommands}` },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `**${CATEGORY_GROUPS.main.label}**\n${renderCategoryList("main")}` },
        { type: 10, content: `**${CATEGORY_GROUPS.side.label}**\n${renderCategoryList("side")}` },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "Select category from Main or Side dropdown to view commands." },
        {
            type: 1,
            components: [
                {
                    type: 3,
                    custom_id: `help_category_main:${token}`,
                    placeholder: "Select Main Category",
                    options: listCategoryOptions("main")
                }
            ]
        },
        {
            type: 1,
            components: [
                {
                    type: 3,
                    custom_id: `help_category_side:${token}`,
                    placeholder: "Select Side Category",
                    options: listCategoryOptions("side")
                }
            ]
        },
        { type: 10, content: `Panel owner: <@${selectedBy}>` }
    ];

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [{ type: 17, components: children }]
    };
}

function buildCategoryPayload({ bot, prefix, categoryKey, page, token, selectedBy }) {
    const category = getCategory(categoryKey);
    const entries = getCategoryEntries(bot, category);

    const totalPages = Math.max(1, Math.ceil(entries.length / COMMANDS_PER_PAGE));
    const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = clampedPage * COMMANDS_PER_PAGE;
    const pageItems = entries.slice(start, start + COMMANDS_PER_PAGE);

    const children = [
        { type: 10, content: "## Hima Help" },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `**Group:** ${CATEGORY_GROUPS[category.group]?.label || "Category"}\n**Selected:** ${category.label}\n${category.description}` },
        ...(category.key === "premium"
            ? [{ type: 10, content: "**Available Musicard Themes**\n1. \`ease\`\n2. \`glass\`\n3. \`neon\`\n4. \`sunset\`\n5. \`ocean\`\n6. \`mono\`" }, { type: 14, divider: true, spacing: 1 }]
            : []),
        { type: 14, divider: true, spacing: 1 }
    ];

    if (!pageItems.length) {
        children.push({ type: 10, content: "No commands found in this category." });
    } else {
        for (let i = 0; i < pageItems.length; i += 1) {
            const block = formatCommandDetail(pageItems[i], prefix, start + i + 1);
            children.push({ type: 10, content: `**${block.title}**\n${block.content}` });
            children.push({ type: 14, divider: true, spacing: 1 });
        }
    }

    children.push({
        type: 1,
        components: [
            {
                type: 2,
                style: 2,
                custom_id: `help_nav:${token}:prev`,
                label: "Previous",
                disabled: clampedPage === 0
            },
            {
                type: 2,
                style: 2,
                custom_id: `help_nav:${token}:next`,
                label: "Next",
                disabled: clampedPage >= totalPages - 1
            },
            {
                type: 2,
                style: 1,
                custom_id: `help_nav:${token}:home`,
                label: "Home"
            }
        ]
    });

    children.push({ type: 10, content: `Page **${clampedPage + 1}/${totalPages}**` });

    children.push({
        type: 1,
        components: [
            {
                type: 3,
                custom_id: `help_category_main:${token}`,
                placeholder: "Switch Main Category",
                options: listCategoryOptions("main")
            }
        ]
    });

    children.push({
        type: 1,
        components: [
            {
                type: 3,
                custom_id: `help_category_side:${token}`,
                placeholder: "Switch Side Category",
                options: listCategoryOptions("side")
            }
        ]
    });

    children.push({ type: 10, content: `Panel owner: <@${selectedBy}>` });

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
                    { type: 10, content: "## Help Panel Expired" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Run help command again." }
                ]
            }
        ]
    };
}

module.exports = {
    name: "help",
    aliases: ["h", "commands"],
    description: "Show command categories and usage details.",
    usage: "help",

    async execute({ bot, message, prefix }) {
        cleanupViews();

        const token = createToken();
        helpViews.set(token, {
            userId: message.author.id,
            prefix,
            mode: "home",
            categoryKey: "music",
            page: 0,
            expiresAt: Date.now() + HELP_VIEW_TTL_MS
        });

        await message.reply(buildHomePayload({
            bot,
            prefix,
            token,
            selectedBy: message.author.id
        }));
    },

    async handleInteraction({ bot, interaction }) {
        cleanupViews();

        if (interaction.isStringSelectMenu() && (interaction.customId.startsWith("help_category_main:") || interaction.customId.startsWith("help_category_side:"))) {
            const [, token] = interaction.customId.split(":");
            const view = helpViews.get(token);
            if (!view || view.expiresAt <= Date.now()) {
                helpViews.delete(token);
                await interaction.update(buildExpiredPayload()).catch(() => null);
                return true;
            }

            if (interaction.user.id !== view.userId) {
                await interaction.deferUpdate().catch(() => null);
                return true;
            }

            view.mode = "category";
            view.categoryKey = interaction.values?.[0] || "music";
            view.page = 0;
            view.expiresAt = Date.now() + HELP_VIEW_TTL_MS;
            helpViews.set(token, view);

            await interaction.update(buildCategoryPayload({
                bot,
                prefix: view.prefix,
                categoryKey: view.categoryKey,
                page: view.page,
                token,
                selectedBy: view.userId
            })).catch(() => null);
            return true;
        }

        if (interaction.isButton() && interaction.customId.startsWith("help_nav:")) {
            const [, token, action] = interaction.customId.split(":");
            const view = helpViews.get(token);
            if (!view || view.expiresAt <= Date.now()) {
                helpViews.delete(token);
                await interaction.update(buildExpiredPayload()).catch(() => null);
                return true;
            }

            if (interaction.user.id !== view.userId) {
                await interaction.deferUpdate().catch(() => null);
                return true;
            }

            if (action === "home") {
                view.mode = "home";
                view.page = 0;
                view.expiresAt = Date.now() + HELP_VIEW_TTL_MS;
                helpViews.set(token, view);

                await interaction.update(buildHomePayload({
                    bot,
                    prefix: view.prefix,
                    token,
                    selectedBy: view.userId
                })).catch(() => null);
                return true;
            }

            const category = getCategory(view.categoryKey);
            const totalCommands = getCategoryEntries(bot, category).length;
            const totalPages = Math.max(1, Math.ceil(totalCommands / COMMANDS_PER_PAGE));

            if (action === "prev") view.page -= 1;
            if (action === "next") view.page += 1;

            view.page = Math.min(Math.max(view.page, 0), totalPages - 1);
            view.mode = "category";
            view.expiresAt = Date.now() + HELP_VIEW_TTL_MS;
            helpViews.set(token, view);

            await interaction.update(buildCategoryPayload({
                bot,
                prefix: view.prefix,
                categoryKey: view.categoryKey,
                page: view.page,
                token,
                selectedBy: view.userId
            })).catch(() => null);

            return true;
        }

        return false;
    }
};

