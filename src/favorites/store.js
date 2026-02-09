const { supabase } = require("../database/supabase");

function nowIso() {
    return new Date().toISOString();
}

function buildTrackKey(track) {
    const uri = String(track?.uri || "").trim();
    if (uri) return `uri:${uri.toLowerCase()}`;

    const query = String(track?.query || track?.title || "").trim();
    return `q:${query.toLowerCase()}`;
}

async function addFavorite(userId, track) {
    const trackKey = buildTrackKey(track);
    const payload = {
        user_id: userId,
        track_key: trackKey,
        query: String(track?.query || track?.uri || track?.title || "").trim(),
        title: track?.title || null,
        uri: track?.uri || null,
        author: track?.author || null,
        source: track?.sourceName || track?.source || null,
        length_ms: Number(track?.length || track?.lengthMs || track?.length_ms || 0) || null,
        created_at: nowIso()
    };

    const { data: existing } = await supabase
        .from("user_favorites")
        .select("id")
        .eq("user_id", userId)
        .eq("track_key", trackKey)
        .maybeSingle();

    if (existing) return { added: false, duplicate: true };

    const { data, error } = await supabase
        .from("user_favorites")
        .insert(payload)
        .select("*")
        .single();

    if (error) throw error;
    return { added: true, duplicate: false, row: data };
}

async function listFavorites(userId) {
    const { data, error } = await supabase
        .from("user_favorites")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function getFavoriteByIndex(userId, index) {
    const items = await listFavorites(userId);
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx < 1 || idx > items.length) return null;
    return { item: items[idx - 1], total: items.length };
}

async function removeFavoriteByIndex(userId, index) {
    const found = await getFavoriteByIndex(userId, index);
    if (!found?.item) return { removed: false };

    const { error } = await supabase
        .from("user_favorites")
        .delete()
        .eq("id", found.item.id)
        .eq("user_id", userId);

    if (error) throw error;
    return { removed: true, item: found.item };
}

module.exports = {
    buildTrackKey,
    addFavorite,
    listFavorites,
    getFavoriteByIndex,
    removeFavoriteByIndex
};
