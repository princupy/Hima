const { supabase } = require("../database/supabase");

async function getSpotifyProfile(userId) {
    const { data, error } = await supabase
        .from("user_spotify_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function upsertSpotifyProfile(payload) {
    const { data, error } = await supabase
        .from("user_spotify_profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select("*")
        .single();

    if (error) throw error;
    return data;
}

async function deleteSpotifyProfile(userId) {
    const { error } = await supabase
        .from("user_spotify_profiles")
        .delete()
        .eq("user_id", userId);

    if (error) throw error;
}

module.exports = {
    getSpotifyProfile,
    upsertSpotifyProfile,
    deleteSpotifyProfile
};
