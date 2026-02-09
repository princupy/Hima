const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("../premium/profile");
const { getSpotifyProfile, upsertSpotifyProfile, deleteSpotifyProfile } = require("./store");

const listCache = new Map();
const LIST_CACHE_TTL_MS = 10 * 60 * 1000;

function parseSpotifyProfileUrl(input) {
    const value = String(input || "").trim();
    const match = value.match(/^https?:\/\/open\.spotify\.com\/user\/([A-Za-z0-9._-]+)/i);
    if (!match) return null;
    return { userId: match[1], profileUrl: `https://open.spotify.com/user/${match[1]}` };
}

async function hasSpotifyFeatureAccess(userId) {
    const [vote, buy] = await Promise.all([
        isVotePremiumActive(userId).catch(() => false),
        hasUserPaidPremiumAccess(userId).catch(() => false)
    ]);
    return vote || buy;
}

async function connectSpotifyProfile(bot, userId, profileUrl) {
    const parsed = parseSpotifyProfileUrl(profileUrl);
    if (!parsed) throw new Error("Invalid Spotify profile URL. Use: https://open.spotify.com/user/<id>");

    const data = await bot.spotify.spotifyGet(`/users/${parsed.userId}`);
    if (!data?.id) throw new Error("Spotify profile not found or not public.");

    const row = await upsertSpotifyProfile({
        user_id: userId,
        spotify_user_id: data.id,
        profile_url: parsed.profileUrl,
        display_name: data.display_name || data.id,
        avatar_url: Array.isArray(data.images) && data.images[0] ? data.images[0].url : null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });

    return row;
}

async function listUserPlaylists(bot, userId, { page = 1, pageSize = 10 } = {}) {
    const profile = await getSpotifyProfile(userId);
    if (!profile) throw new Error("No Spotify profile connected. Use spconnect first.");

    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(20, Math.max(5, Number(pageSize) || 10));
    const offset = (safePage - 1) * safePageSize;

    const data = await bot.spotify.spotifyGet(`/users/${profile.spotify_user_id}/playlists?limit=${safePageSize}&offset=${offset}`);
    const items = Array.isArray(data?.items) ? data.items : [];

    const list = items.map((p, idx) => ({
        index: offset + idx + 1,
        id: p.id,
        name: p.name || "Untitled",
        tracks: Number(p?.tracks?.total || 0),
        owner: p?.owner?.display_name || p?.owner?.id || "Unknown",
        url: p?.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`
    }));

    listCache.set(userId, {
        expiresAt: Date.now() + LIST_CACHE_TTL_MS,
        items: list,
        page: safePage,
        pageSize: safePageSize
    });

    return {
        profile,
        items: list,
        total: Number(data?.total || 0),
        page: safePage,
        pageSize: safePageSize,
        hasNext: Boolean(data?.next),
        hasPrev: Boolean(data?.previous)
    };
}

function getCachedPlaylistByNumber(userId, number) {
    const cached = listCache.get(userId);
    if (!cached || cached.expiresAt <= Date.now()) return null;

    const n = Number(number);
    if (!Number.isFinite(n) || n < 1) return null;
    return cached.items.find((x) => x.index === n) || null;
}

async function disconnectSpotifyProfile(userId) {
    await deleteSpotifyProfile(userId);
    listCache.delete(userId);
}

module.exports = {
    parseSpotifyProfileUrl,
    hasSpotifyFeatureAccess,
    connectSpotifyProfile,
    listUserPlaylists,
    getCachedPlaylistByNumber,
    disconnectSpotifyProfile,
    getSpotifyProfile
};
