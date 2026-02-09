const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

function makeCacheKey(artist, title, query) {
    return `${String(artist || "").toLowerCase()}|${String(title || "").toLowerCase()}|${String(query || "").toLowerCase()}`;
}

function getCached(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return item.value;
}

function setCached(key, value) {
    cache.set(key, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

function cleanTitle(input) {
    return String(input || "")
        .replace(/\([^)]*\)/g, " ")
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/\b(official\s+video|official\s+music\s+video|official\s+audio|lyrics?|lyric\s+video|video\s+song)\b/gi, " ")
        .replace(/\b(ft\.?|feat\.?|featuring)\b.*$/i, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanArtist(input) {
    return String(input || "")
        .replace(/\s+/g, " ")
        .trim();
}

function parseArtistTitleFromQuery(query) {
    const raw = String(query || "").trim();
    if (!raw) return { artist: null, title: null };

    const byDash = raw.split(/\s[-|:]\s/);
    if (byDash.length >= 2) {
        const artist = cleanArtist(byDash[0]);
        const title = cleanTitle(byDash.slice(1).join(" - "));
        if (artist && title) return { artist, title };
    }

    return { artist: null, title: cleanTitle(raw) || null };
}

async function requestLyricsOvh(artist, title) {
    if (!artist || !title) return null;
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) return null;

    const data = await res.json().catch(() => null);
    const lyrics = String(data?.lyrics || "").trim();
    if (!lyrics) return null;

    return {
        artist,
        title,
        lyrics,
        source: "lyrics.ovh"
    };
}

async function requestLrcLib(artist, title) {
    const params = new URLSearchParams();
    if (artist) params.set("artist_name", artist);
    if (title) params.set("track_name", title);

    const url = `https://lrclib.net/api/search?${params.toString()}`;
    const res = await fetch(url, {
        headers: {
            "user-agent": "hima-bot/1.0"
        }
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!Array.isArray(data) || !data.length) return null;

    const first = data.find((x) => x?.plainLyrics) || data[0];
    const lyrics = String(first?.plainLyrics || first?.syncedLyrics || "").trim();
    if (!lyrics) return null;

    return {
        artist: first.artistName || artist || "Unknown",
        title: first.trackName || title || "Unknown",
        lyrics,
        source: "lrclib"
    };
}

async function fetchLyrics(artist, title) {
    const cleanA = cleanArtist(artist);
    const cleanT = cleanTitle(title);
    const key = makeCacheKey(cleanA, cleanT, "");
    const cached = getCached(key);
    if (cached) return cached;

    let result = await requestLyricsOvh(cleanA, cleanT);
    if (!result) {
        result = await requestLrcLib(cleanA, cleanT);
    }

    if (result) setCached(key, result);
    return result;
}

async function fetchLyricsByQuery(query) {
    const parsed = parseArtistTitleFromQuery(query);
    const key = makeCacheKey(parsed.artist, parsed.title, query);
    const cached = getCached(key);
    if (cached) return cached;

    let result = null;

    if (parsed.artist && parsed.title) {
        result = await requestLyricsOvh(parsed.artist, parsed.title);
        if (!result) result = await requestLrcLib(parsed.artist, parsed.title);
    } else if (parsed.title) {
        result = await requestLrcLib(null, parsed.title);
        if (!result && parsed.title.includes(" ")) {
            const maybe = parseArtistTitleFromQuery(parsed.title.replace(/\s+/g, " "));
            if (maybe.artist && maybe.title) {
                result = await requestLyricsOvh(maybe.artist, maybe.title);
                if (!result) result = await requestLrcLib(maybe.artist, maybe.title);
            }
        }
    }

    if (result) setCached(key, result);
    return result;
}

const DEV_VOWELS = {
    "\u0905": "a",
    "\u0906": "aa",
    "\u0907": "i",
    "\u0908": "ee",
    "\u0909": "u",
    "\u090A": "oo",
    "\u090B": "ri",
    "\u090F": "e",
    "\u0910": "ai",
    "\u0913": "o",
    "\u0914": "au",
    "\u0911": "o",
    "\u090D": "e",
    "\u0972": "a"
};

const DEV_CONSONANTS = {
    "\u0915": "k",
    "\u0916": "kh",
    "\u0917": "g",
    "\u0918": "gh",
    "\u0919": "ng",
    "\u091A": "ch",
    "\u091B": "chh",
    "\u091C": "j",
    "\u091D": "jh",
    "\u091E": "ny",
    "\u091F": "t",
    "\u0920": "th",
    "\u0921": "d",
    "\u0922": "dh",
    "\u0923": "n",
    "\u0924": "t",
    "\u0925": "th",
    "\u0926": "d",
    "\u0927": "dh",
    "\u0928": "n",
    "\u092A": "p",
    "\u092B": "ph",
    "\u092C": "b",
    "\u092D": "bh",
    "\u092E": "m",
    "\u092F": "y",
    "\u0930": "r",
    "\u0932": "l",
    "\u0935": "v",
    "\u0936": "sh",
    "\u0937": "sh",
    "\u0938": "s",
    "\u0939": "h",
    "\u0933": "l",
    "\u0958": "q",
    "\u0959": "kh",
    "\u095A": "g",
    "\u095B": "z",
    "\u095C": "r",
    "\u095D": "rh",
    "\u095E": "f",
    "\u095F": "y"
};

const DEV_MATRA = {
    "\u093E": "aa",
    "\u093F": "i",
    "\u0940": "ee",
    "\u0941": "u",
    "\u0942": "oo",
    "\u0943": "ri",
    "\u0947": "e",
    "\u0948": "ai",
    "\u094B": "o",
    "\u094C": "au",
    "\u0949": "o",
    "\u0945": "e"
};

const DEV_SIGNS = {
    "\u0902": "n",
    "\u0901": "n",
    "\u0903": "h",
    "\u094D": ""
};

function isDevanagari(ch) {
    const code = ch.charCodeAt(0);
    return code >= 0x0900 && code <= 0x097F;
}

function transliterateDevanagari(text) {
    const chars = Array.from(String(text || ""));
    let out = "";

    for (let i = 0; i < chars.length; i += 1) {
        const ch = chars[i];

        if (!isDevanagari(ch)) {
            out += ch;
            continue;
        }

        if (DEV_VOWELS[ch]) {
            out += DEV_VOWELS[ch];
            continue;
        }

        if (DEV_SIGNS[ch] && ch !== "\u094D") {
            out += DEV_SIGNS[ch];
            continue;
        }

        if (DEV_CONSONANTS[ch]) {
            const base = DEV_CONSONANTS[ch];
            const next = chars[i + 1];

            if (next === "\u094D") {
                out += base;
                i += 1;
                continue;
            }

            if (next && DEV_MATRA[next]) {
                out += `${base}${DEV_MATRA[next]}`;
                i += 1;
                continue;
            }

            out += `${base}a`;
            continue;
        }

        out += ch;
    }

    return out
        .replace(/aaee/g, "ai")
        .replace(/aaoo/g, "au")
        .replace(/\s+/g, " ")
        .trim();
}

function toHinglishLyrics(text) {
    const raw = String(text || "");
    if (!raw) return "";

    return raw
        .split(/\r?\n/)
        .map((line) => transliterateDevanagari(line))
        .join("\n")
        .trim();
}

module.exports = {
    fetchLyrics,
    fetchLyricsByQuery,
    parseArtistTitleFromQuery,
    cleanTitle,
    cleanArtist,
    toHinglishLyrics
};
