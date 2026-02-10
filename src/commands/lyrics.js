const { MessageFlags } = require("discord.js");
const { fetchLyrics, fetchLyricsByQuery, toHinglishLyrics } = require("../utils/lyrics");
const { formatDuration } = require("../utils/format");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const VIEW_TTL_MS = 15 * 60 * 1000;
const MAX_PAGE_CHARS = 1800;
const MAX_STANZAS_PER_PAGE = 3;
const lyricsViews = new Map();

function cleanupViews() {
    const now = Date.now();
    for (const [token, view] of lyricsViews) {
        if (view.expiresAt <= now) lyricsViews.delete(token);
    }
}

function makeToken() {
    return Math.random().toString(36).slice(2, 10);
}

function shortText(value, max = 64) {
    const text = String(value || "Unknown").trim();
    if (!text) return "Unknown";
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
}

function parseModeAndQuery(args) {
    const first = String(args[0] || "").toLowerCase();
    const hinglishKeys = new Set(["hinglish", "hi", "roman", "romanized", "translit"]);

    if (hinglishKeys.has(first)) {
        return {
            mode: "hinglish",
            query: args.slice(1).join(" ").trim()
        };
    }

    return {
        mode: "normal",
        query: args.join(" ").trim()
    };
}

function splitLyricsStanzas(text) {
    const clean = String(text || "").replace(/\r/g, "").trim();
    if (!clean) return ["No lyrics text available."];

    const stanzas = clean
        .split(/\n\s*\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

    return stanzas.length ? stanzas : [clean];
}

function paginateStanzas(stanzas) {
    const pages = [];
    let current = [];
    let chars = 0;

    for (const stanza of stanzas) {
        const blockLen = stanza.length + 8;
        const tooManyBlocks = current.length >= MAX_STANZAS_PER_PAGE;
        const tooLong = chars + blockLen > MAX_PAGE_CHARS;

        if (current.length && (tooManyBlocks || tooLong)) {
            pages.push(current);
            current = [];
            chars = 0;
        }

        current.push(stanza);
        chars += blockLen;
    }

    if (current.length) pages.push(current);
    return pages.length ? pages : [["No lyrics available."]];
}

function makeStanzaBlock(stanza) {
    const lines = String(stanza || "")
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 8);

    const body = lines.join("\n") || "...";
    return `| ${body}`;
}

function buildLyricsPayload(view) {
    const total = view.pages.length;
    const index = view.index;
    const currentStanzas = view.pages[index] || [];

    const stanzaComponents = currentStanzas.map((stanza) => ({
        type: 10,
        content: makeStanzaBlock(stanza)
    }));

    const headerInfo = [
        `**Artist:** ${shortText(view.artist, 48)}`,
        `**Duration:** ${view.durationText}`,
        `**Requester:** ${view.requesterText}`
    ].join("\n");

    const children = [
        { type: 10, content: `## ${shortText(view.title, 64)}` },
        { type: 14, divider: true, spacing: 1 },
        {
            type: 9,
            components: [{ type: 10, content: headerInfo }],
            ...(view.image
                ? {
                    accessory: {
                        type: 11,
                        media: { url: view.image }
                    }
                }
                : {})
        },
        { type: 14, divider: true, spacing: 1 },
        ...stanzaComponents,
        { type: 14, divider: true, spacing: 1 },
        {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 2,
                    custom_id: `lyrics_nav:${view.token}:prev`,
                    label: "Previous",
                    disabled: index <= 0
                },
                {
                    type: 2,
                    style: 2,
                    custom_id: `lyrics_nav:${view.token}:home`,
                    label: "Home",
                    disabled: index === 0
                },
                {
                    type: 2,
                    style: 2,
                    custom_id: `lyrics_nav:${view.token}:next`,
                    label: "Next",
                    disabled: index >= total - 1
                }
            ]
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `-# Source: ${view.source} - Page ${index + 1}/${total}` }
    ];

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [{ type: 17, components: children }]
    };
}

module.exports = {
    name: "lyrics",
    aliases: ["ly"],
    description: "Fetch lyrics (normal or Hinglish transliteration).",
    usage: "lyrics [hinglish|hi] [song or artist - title]",

    async execute({ bot, message, args, reply }) {
        cleanupViews();

        const { mode, query } = parseModeAndQuery(args);

        let data = null;
        let nowPlaying = bot.music.getNowPlaying(message.guild.id);

        if (query) {
            data = await fetchLyricsByQuery(query).catch(() => null);
        } else {
            if (!nowPlaying) {
                await reply({ title: "Nothing Playing", description: "Play a song first or use `lyrics <song name>`. Hinglish: `lyrics hinglish <song>`" });
                return;
            }

            const track = nowPlaying.track;
            data = await fetchLyrics(track.author || "Unknown", track.title || "Unknown").catch(() => null);

            if (!data && track?.title) {
                data = await fetchLyricsByQuery(track.title).catch(() => null);
            }
        }

        if (!data || !data.lyrics) {
            await reply({
                title: "Lyrics Not Found",
                description: query
                    ? `No lyrics found for **${query}**.`
                    : "No lyrics found for current track. Try `lyrics <song name>`."
            });
            return;
        }

        const finalText = mode === "hinglish"
            ? (toHinglishLyrics(data.lyrics) || data.lyrics)
            : data.lyrics;

        const stanzas = splitLyricsStanzas(finalText);
        const pages = paginateStanzas(stanzas);

        const token = makeToken();
        const nowTrack = nowPlaying?.track || null;

        const view = {
            token,
            userId: message.author.id,
            artist: data.artist,
            title: mode === "hinglish" ? `${data.title} (Hinglish)` : data.title,
            source: data.source,
            pages,
            index: 0,
            image: nowTrack?.artworkUrl || null,
            durationText: nowTrack?.length ? formatDuration(nowTrack.length) : "Unknown",
            requesterText: nowTrack?.requesterId ? `<@${nowTrack.requesterId}>` : `<@${message.author.id}>`,
            expiresAt: Date.now() + VIEW_TTL_MS
        };

        lyricsViews.set(token, view);
        await message.reply(buildLyricsPayload(view));
    },

    async handleInteraction({ interaction }) {
        if (!interaction.isButton() || !interaction.customId.startsWith("lyrics_nav:")) return false;

        cleanupViews();
        const [, token, action] = interaction.customId.split(":");
        const view = lyricsViews.get(token);

        if (!view || view.expiresAt <= Date.now()) {
            lyricsViews.delete(token);
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [{
                    type: 17,
                    components: [
                        { type: 10, content: "## Lyrics Panel Expired" },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: "Run lyrics command again." }
                    ]
                }]
            }).catch(() => null);
            return true;
        }

        if (interaction.user.id !== view.userId) {
            await interaction.reply({
                flags: COMPONENTS_V2_FLAG | 64,
                components: [{
                    type: 17,
                    components: [
                        { type: 10, content: "## Not Allowed" },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: `Only <@${view.userId}> can use these lyrics controls.` }
                    ]
                }]
            }).catch(() => null);
            return true;
        }

        if (action === "prev") view.index -= 1;
        if (action === "next") view.index += 1;
        if (action === "home") view.index = 0;

        view.index = Math.min(Math.max(view.index, 0), view.pages.length - 1);
        view.expiresAt = Date.now() + VIEW_TTL_MS;
        lyricsViews.set(token, view);

        await interaction.update(buildLyricsPayload(view)).catch(() => null);
        return true;
    }
};
