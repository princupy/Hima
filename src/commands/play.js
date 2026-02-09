const { ChannelType } = require("discord.js");

const SEARCH_CACHE_TTL_MS = Math.max(5_000, Number(process.env.PLAY_SEARCH_CACHE_TTL_MS || 120_000));
const searchCache = new Map();

function toLinkedTitle(track) {
    const title = track?.title || "Unknown Track";
    const url = track?.uri;
    return url ? `[${title}](${url})` : title;
}

function nowMs() {
    return Date.now();
}

function normalizeQueryForCache(query) {
    return String(query || "").trim().toLowerCase();
}

function makeCacheKey(guildId, query, withSpotifyFallback) {
    return `${guildId || "global"}:${withSpotifyFallback ? "sp" : "std"}:${normalizeQueryForCache(query)}`;
}

function cloneResult(res) {
    if (!res) return res;
    return {
        ...res,
        tracks: Array.isArray(res.tracks) ? res.tracks.map((t) => ({ ...t })) : []
    };
}

function getCachedResult(guildId, query, withSpotifyFallback) {
    const key = makeCacheKey(guildId, query, withSpotifyFallback);
    const hit = searchCache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= nowMs()) {
        searchCache.delete(key);
        return null;
    }
    return cloneResult(hit.value);
}

function setCachedResult(guildId, query, withSpotifyFallback, result) {
    if (!result || !result.tracks?.length || result.loadType === "error" || result.loadType === "empty") return;

    const key = makeCacheKey(guildId, query, withSpotifyFallback);
    searchCache.set(key, {
        value: cloneResult(result),
        expiresAt: nowMs() + SEARCH_CACHE_TTL_MS
    });
}

function pruneCache() {
    const now = nowMs();
    for (const [key, value] of searchCache.entries()) {
        if (value.expiresAt <= now) searchCache.delete(key);
    }
}

function getSpotifySearchConcurrency() {
    const raw = Number(process.env.SPOTIFY_SEARCH_CONCURRENCY || 6);
    if (!Number.isFinite(raw)) return 6;
    return Math.min(Math.max(Math.floor(raw), 1), 12);
}

function stripSearchPrefix(q) {
    return q.replace(/^(ytsearch:|ytmsearch:|scsearch:)/i, "").trim();
}

function uniqueQueries(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
        const key = item.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

function buildSpotifyCandidates(seedQuery) {
    const base = stripSearchPrefix(seedQuery)
        .replace(/\bofficial\s+audio\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    return uniqueQueries([
        seedQuery,
        `ytmsearch:${base}`,
        `ytsearch:${base}`,
        `scsearch:${base}`
    ]);
}

async function searchOnce(bot, candidate, guildId) {
    try {
        const res = await bot.music.search(candidate, guildId);
        if (res.loadType !== "empty" && res.loadType !== "error" && res.tracks?.length) {
            return res;
        }
        return null;
    } catch {
        return null;
    }
}

async function searchFastestCandidate(bot, candidates, guildId) {
    if (!candidates.length) return null;

    const racers = candidates.map((candidate) => (
        searchOnce(bot, candidate, guildId).then((res) => {
            if (!res) throw new Error("empty");
            return res;
        })
    ));

    try {
        return await Promise.any(racers);
    } catch {
        return null;
    }
}

async function searchWithFallback(bot, seedQuery, withSpotifyFallback = false, guildId = null) {
    const cached = getCachedResult(guildId, seedQuery, withSpotifyFallback);
    if (cached) return cached;

    const candidates = withSpotifyFallback
        ? buildSpotifyCandidates(seedQuery)
        : [seedQuery];

    let result = null;

    if (withSpotifyFallback) {
        // Fast path: race top 3 engines and take first successful hit.
        result = await searchFastestCandidate(bot, candidates.slice(0, 3), guildId);

        // Slow fallback only if no hit in fast race.
        if (!result && candidates.length > 3) {
            for (const candidate of candidates.slice(3)) {
                result = await searchOnce(bot, candidate, guildId);
                if (result) break;
            }
        }
    } else {
        result = await searchOnce(bot, seedQuery, guildId);
    }

    if (!result) {
        return { loadType: "empty", tracks: [] };
    }

    setCachedResult(guildId, seedQuery, withSpotifyFallback, result);
    return result;
}

module.exports = {
    name: "play",
    aliases: ["p"],
    description: "Play a song from YouTube search/URL or Spotify URL.",
    usage: "play <song/url>",
    async execute({ bot, message, args, reply }) {
        pruneCache();

        if (!args.length) {
            await reply({
                title: "Missing Query",
                description: "Provide a song name or URL."
            });
            return;
        }

        const voice = message.member?.voice?.channel;
        if (!voice) {
            await reply({
                title: "Voice Channel Required",
                description: "Join a voice channel before using play."
            });
            return;
        }

        const me = message.guild.members.me;
        const myPerms = voice.permissionsFor(me);
        if (!myPerms?.has("Connect") || !myPerms?.has("Speak")) {
            await reply({
                title: "Missing Permissions",
                description: "I need Connect and Speak in your voice channel."
            });
            return;
        }

        const query = args.join(" ");
        const shardId = message.guild.shardId ?? 0;

        let state = bot.music.get(message.guild.id);
        if (!state) {
            try {
                state = await bot.music.create(message.guild.id, voice.id, message.channel.id, shardId, message.author.id);
            } catch (error) {
                await reply({
                    title: "Voice Join Failed",
                    description: "I could not connect to your voice channel.",
                    fields: [{ name: "Reason", value: String(error?.message || error) }]
                });
                return;
            }
        }

        const hadCurrentTrack = Boolean(state.current);

        if (voice.type === ChannelType.GuildStageVoice) {
            await message.guild.members.me.voice.setSuppressed(false).catch(() => null);
        }

        let failed = 0;
        const addedTracks = [];

        const addTracksFromResult = (res) => {
            if (!res || !res.tracks || !res.tracks.length) return 0;
            const tracksToAdd = res.loadType === "playlist" ? res.tracks : [res.tracks[0]];
            for (const t of tracksToAdd) {
                t.requester = message.author.tag;
                t.requesterId = message.author.id;
            }
            addedTracks.push(...tracksToAdd);
            return bot.music.enqueue(message.guild.id, tracksToAdd);
        };

        if (bot.spotify.isSpotifyUrl(query)) {
            let spotifyQueries = [];
            try {
                spotifyQueries = await bot.spotify.resolveToSearchQueries(query);
            } catch (error) {
                await reply({
                    title: "Spotify Error",
                    description: "Failed to read Spotify URL.",
                    fields: [{ name: "Reason", value: String(error.message || error) }]
                });
                return;
            }

            const concurrency = getSpotifySearchConcurrency();
            let startedPlayback = false;

            for (let i = 0; i < spotifyQueries.length; i += concurrency) {
                const chunk = spotifyQueries.slice(i, i + concurrency);

                const results = await Promise.all(
                    chunk.map((q) => searchWithFallback(bot, q, true, message.guild.id))
                );

                for (const res of results) {
                    if (res.loadType === "error" || res.loadType === "empty" || !res.tracks?.length) {
                        failed += 1;
                        continue;
                    }
                    addTracksFromResult(res);
                }

                if (!startedPlayback && addedTracks.length > 0) {
                    await bot.music.playIfIdle(message.guild.id);
                    startedPlayback = true;
                }
            }
        } else {
            const isUrl = /^https?:\/\//i.test(query);
            let res = { loadType: "empty", tracks: [] };

            if (isUrl) {
                res = await searchWithFallback(bot, query, false, message.guild.id);
            } else {
                const [ytm, yt] = await Promise.all([
                    searchWithFallback(bot, `ytmsearch:${query}`, false, message.guild.id),
                    searchWithFallback(bot, `ytsearch:${query}`, false, message.guild.id)
                ]);

                if (ytm.loadType !== "empty" && ytm.tracks?.length) {
                    res = ytm;
                } else if (yt.loadType !== "empty" && yt.tracks?.length) {
                    res = yt;
                } else {
                    res = await searchWithFallback(bot, `scsearch:${query}`, false, message.guild.id);
                }
            }

            if (res.loadType === "error") {
                await reply({
                    title: "Search Failed",
                    description: "Lavalink could not load this query.",
                    fields: [{ name: "Reason", value: String(res.exception?.message || "Unknown") }]
                });
                return;
            }

            if (res.loadType === "empty" || !res.tracks?.length) {
                await reply({
                    title: "No Results",
                    description: "No tracks found for your query."
                });
                return;
            }

            addTracksFromResult(res);
        }

        await bot.music.playIfIdle(message.guild.id);

        const playlistCommand = bot.commandMap.get("playlist");
        if (playlistCommand && typeof playlistCommand.autoSyncFromPlay === "function" && addedTracks.length) {
            await playlistCommand.autoSyncFromPlay({ message, tracks: addedTracks }).catch(() => null);
        }

        if (!addedTracks.length) {
            await reply({
                title: "No Results",
                description: "No tracks could be queued for this request.",
                fields: [{ name: "Failed", value: String(failed) }]
            });
            return;
        }

        if (hadCurrentTrack) {
            const top = addedTracks[0] || null;
            await reply({
                title: "Queue Updated",
                description: top
                    ? `Added: ${toLinkedTitle(top)}`
                    : "Added to queue.",
                footer: `Requested by ${message.author.username}`
            });
        }
    }
};
