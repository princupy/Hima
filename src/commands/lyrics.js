const { MessageFlags } = require("discord.js");
const { fetchLyrics, fetchLyricsByQuery, toHinglishLyrics } = require("../utils/lyrics");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const VIEW_TTL_MS = 15 * 60 * 1000;
const MAX_PAGE_CHARS = 1200;
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

function splitLyricsPages(text, maxChars = MAX_PAGE_CHARS) {
    const clean = String(text || "").trim();
    if (!clean) return ["No lyrics text available."];

    const lines = clean.split(/\r?\n/);
    const pages = [];
    let current = "";

    for (const line of lines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > maxChars) {
            if (current) pages.push(current);
            current = line.length > maxChars ? line.slice(0, maxChars) : line;
        } else {
            current = candidate;
        }
    }

    if (current) pages.push(current);
    return pages.length ? pages : [clean.slice(0, maxChars)];
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

function buildLyricsPayload({ token, artist, title, source, mode, pages, index }) {
    const page = pages[index] || pages[0] || "No lyrics found.";
    const total = pages.length;

    const controls = total > 1
        ? [
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 2,
                        custom_id: `lyrics_nav:${token}:prev`,
                        label: "Previous",
                        disabled: index <= 0
                    },
                    {
                        type: 2,
                        style: 2,
                        custom_id: `lyrics_nav:${token}:next`,
                        label: "Next",
                        disabled: index >= total - 1
                    }
                ]
            }
        ]
        : [];

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## Lyrics" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: `**${title}** - **${artist}**` },
                    { type: 10, content: page },
                    ...controls,
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: `Page ${index + 1}/${total} • Source: ${source} • Mode: ${mode}` }
                ]
            }
        ]
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
        if (query) {
            data = await fetchLyricsByQuery(query).catch(() => null);
        } else {
            const now = bot.music.getNowPlaying(message.guild.id);
            if (!now) {
                await reply({ title: "Nothing Playing", description: "Play a song first or use `lyrics <song name>`. Hinglish: `lyrics hinglish <song>`" });
                return;
            }

            const track = now.track;
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

        const pages = splitLyricsPages(finalText, MAX_PAGE_CHARS);

        if (pages.length <= 1) {
            await reply({
                title: mode === "hinglish" ? "Lyrics (Hinglish)" : "Lyrics",
                description: `**${data.title}** - **${data.artist}**`,
                fields: [{ name: `Source: ${data.source} • Mode: ${mode}`, value: pages[0] }]
            });
            return;
        }

        const token = makeToken();
        lyricsViews.set(token, {
            userId: message.author.id,
            artist: data.artist,
            title: data.title,
            source: data.source,
            mode,
            pages,
            index: 0,
            expiresAt: Date.now() + VIEW_TTL_MS
        });

        await message.reply(buildLyricsPayload({
            token,
            artist: data.artist,
            title: data.title,
            source: data.source,
            mode,
            pages,
            index: 0
        }));
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
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Lyrics Panel Expired" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "Run lyrics command again." }
                        ]
                    }
                ]
            }).catch(() => null);
            return true;
        }

        if (interaction.user.id !== view.userId) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        if (action === "prev") view.index -= 1;
        if (action === "next") view.index += 1;

        view.index = Math.min(Math.max(view.index, 0), view.pages.length - 1);
        view.expiresAt = Date.now() + VIEW_TTL_MS;
        lyricsViews.set(token, view);

        await interaction.update(buildLyricsPayload({
            token,
            artist: view.artist,
            title: view.title,
            source: view.source,
            mode: view.mode,
            pages: view.pages,
            index: view.index
        })).catch(() => null);

        return true;
    }
};
