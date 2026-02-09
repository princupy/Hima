const { supabase } = require("../database/supabase");

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

function key(guildId, userId) {
    return `${guildId}:${userId}`;
}

function nowIso() {
    return new Date().toISOString();
}

function cacheSet(guildId, userId, enabled) {
    cache.set(key(guildId, userId), {
        enabled: Boolean(enabled),
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

function cacheGet(guildId, userId) {
    const row = cache.get(key(guildId, userId));
    if (!row || row.expiresAt <= Date.now()) return null;
    return row.enabled;
}

async function ensureVoicePlayRow(guildId, userId) {
    const payload = {
        guild_id: guildId,
        user_id: userId,
        enabled: false,
        created_at: nowIso(),
        updated_at: nowIso()
    };

    const { error } = await supabase
        .from("user_voice_play_settings")
        .upsert(payload, { onConflict: "guild_id,user_id", ignoreDuplicates: true });

    if (error) throw error;
}

async function getVoicePlayEnabled(guildId, userId) {
    const cached = cacheGet(guildId, userId);
    if (cached !== null) return cached;

    const { data, error } = await supabase
        .from("user_voice_play_settings")
        .select("enabled")
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        console.error("[VoicePlay:get]", error.message || error);
        return false;
    }

    const enabled = Boolean(data?.enabled);
    cacheSet(guildId, userId, enabled);
    return enabled;
}

async function setVoicePlayEnabled(guildId, userId, enabled) {
    await ensureVoicePlayRow(guildId, userId);

    const { data, error } = await supabase
        .from("user_voice_play_settings")
        .update({
            enabled: Boolean(enabled),
            updated_at: nowIso()
        })
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .select("enabled")
        .single();

    if (error) throw error;

    const value = Boolean(data?.enabled);
    cacheSet(guildId, userId, value);
    return value;
}

module.exports = {
    ensureVoicePlayRow,
    getVoicePlayEnabled,
    setVoicePlayEnabled
};
