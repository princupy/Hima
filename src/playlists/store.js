const { supabase } = require("../database/supabase");

function nowIso() {
    return new Date().toISOString();
}

function makeId() {
    return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function createPlaylist({ ownerUserId, guildId = null, scope = "user", name }) {
    const id = makeId();
    const payload = {
        id,
        owner_user_id: ownerUserId,
        guild_id: scope === "shared" ? guildId : null,
        scope,
        name: String(name || "").trim(),
        created_at: nowIso(),
        updated_at: nowIso()
    };

    const { data, error } = await supabase
        .from("playlists")
        .insert(payload)
        .select("*")
        .single();

    if (error) throw error;
    return data;
}

async function getPlaylistById(playlistId) {
    const { data, error } = await supabase
        .from("playlists")
        .select("*")
        .eq("id", playlistId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function findPlaylist({ ownerUserId, guildId, scope, name }) {
    let q = supabase
        .from("playlists")
        .select("*")
        .eq("scope", scope)
        .eq("name", String(name || "").trim())
        .limit(1);

    if (scope === "shared") {
        q = q.eq("guild_id", guildId);
    } else {
        q = q.eq("owner_user_id", ownerUserId);
    }

    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data || null;
}

async function listPlaylists({ ownerUserId, guildId, scope }) {
    let q = supabase
        .from("playlists")
        .select("*")
        .eq("scope", scope)
        .order("updated_at", { ascending: false });

    if (scope === "shared") {
        q = q.eq("guild_id", guildId);
    } else {
        q = q.eq("owner_user_id", ownerUserId);
    }

    const { data, error } = await q;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function deletePlaylist(playlistId) {
    const { error } = await supabase
        .from("playlists")
        .delete()
        .eq("id", playlistId);

    if (error) throw error;
}

async function getTracks(playlistId) {
    const { data, error } = await supabase
        .from("playlist_tracks")
        .select("*")
        .eq("playlist_id", playlistId)
        .order("position", { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function addTrack(playlistId, track) {
    const current = await getTracks(playlistId);
    const pos = current.length + 1;
    const payload = {
        playlist_id: playlistId,
        position: pos,
        query: String(track.query || "").trim(),
        title: track.title || null,
        uri: track.uri || null,
        source: track.source || null,
        length_ms: Number(track.lengthMs || 0) || null,
        created_at: nowIso()
    };

    const { data, error } = await supabase
        .from("playlist_tracks")
        .insert(payload)
        .select("*")
        .single();

    if (error) throw error;

    await supabase
        .from("playlists")
        .update({ updated_at: nowIso() })
        .eq("id", playlistId);

    return data;
}

async function removeTrackAt(playlistId, position) {
    const pos = Number(position);
    if (!Number.isFinite(pos) || pos < 1) return false;

    const { error } = await supabase
        .from("playlist_tracks")
        .delete()
        .eq("playlist_id", playlistId)
        .eq("position", pos);

    if (error) throw error;

    const items = await getTracks(playlistId);
    for (let i = 0; i < items.length; i += 1) {
        const wanted = i + 1;
        if (items[i].position === wanted) continue;
        await supabase
            .from("playlist_tracks")
            .update({ position: wanted })
            .eq("id", items[i].id);
    }

    await supabase
        .from("playlists")
        .update({ updated_at: nowIso() })
        .eq("id", playlistId);

    return true;
}

async function clearTracks(playlistId) {
    const { error } = await supabase
        .from("playlist_tracks")
        .delete()
        .eq("playlist_id", playlistId);

    if (error) throw error;

    await supabase
        .from("playlists")
        .update({ updated_at: nowIso() })
        .eq("id", playlistId);
}

async function getSettings(guildId, userId) {
    const { data, error } = await supabase
        .from("playlist_settings")
        .select("*")
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function setSettings(guildId, userId, patch) {
    const base = {
        guild_id: guildId,
        user_id: userId,
        autosync_enabled: false,
        autosync_playlist_id: null,
        autoload_playlist_id: null,
        created_at: nowIso(),
        updated_at: nowIso()
    };

    const { data: existing } = await supabase
        .from("playlist_settings")
        .select("*")
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .maybeSingle();

    const payload = {
        ...(existing || base),
        ...patch,
        guild_id: guildId,
        user_id: userId,
        updated_at: nowIso()
    };

    const { data, error } = await supabase
        .from("playlist_settings")
        .upsert(payload, { onConflict: "guild_id,user_id" })
        .select("*")
        .single();

    if (error) throw error;
    return data;
}

module.exports = {
    createPlaylist,
    getPlaylistById,
    findPlaylist,
    listPlaylists,
    deletePlaylist,
    getTracks,
    addTrack,
    removeTrackAt,
    clearTracks,
    getSettings,
    setSettings
};
