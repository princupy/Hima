const { supabase } = require("./supabase");
const { loadConfig } = require("../config");

const cfg = loadConfig();
const cache = new Map();

function setCache(guildId, data) {
    cache.set(guildId, {
        prefix: data.prefix,
        musicChannelId: data.music_channel_id || null,
        expiresAt: Date.now() + cfg.supabase.prefixCacheTtlMs
    });
}

async function fetchGuildRow(guildId) {
    const { data, error } = await supabase
        .from("guilds")
        .select("prefix, music_channel_id")
        .eq("id", guildId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

/**
 * @param {string} guildId
 */
async function ensureGuild(guildId) {
    const nowIso = new Date().toISOString();

    const { error: upsertError } = await supabase
        .from("guilds")
        .upsert(
            {
                id: guildId,
                prefix: cfg.defaults.prefix,
                music_channel_id: null,
                created_at: nowIso
            },
            { onConflict: "id", ignoreDuplicates: true }
        );

    if (upsertError) throw upsertError;

    const row = await fetchGuildRow(guildId);
    const normalized = {
        prefix: row?.prefix || cfg.defaults.prefix,
        music_channel_id: row?.music_channel_id || null
    };

    setCache(guildId, normalized);
    return normalized.prefix;
}

/**
 * @param {string} guildId
 */
async function getPrefix(guildId) {
    const cached = cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.prefix;

    let row = null;
    try {
        row = await fetchGuildRow(guildId);
    } catch (error) {
        console.error("[Supabase getPrefix]", error);
        return cfg.defaults.prefix;
    }

    if (!row) {
        return ensureGuild(guildId);
    }

    const normalized = {
        prefix: row.prefix || cfg.defaults.prefix,
        music_channel_id: row.music_channel_id || null
    };

    setCache(guildId, normalized);
    return normalized.prefix;
}

/**
 * @param {string} guildId
 */
async function getMusicChannel(guildId) {
    const cached = cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.musicChannelId;

    let row = null;
    try {
        row = await fetchGuildRow(guildId);
    } catch (error) {
        console.error("[Supabase getMusicChannel]", error);
        return null;
    }

    if (!row) {
        await ensureGuild(guildId);
        return null;
    }

    const normalized = {
        prefix: row.prefix || cfg.defaults.prefix,
        music_channel_id: row.music_channel_id || null
    };

    setCache(guildId, normalized);
    return normalized.music_channel_id;
}

/**
 * @param {string} guildId
 * @param {string} prefix
 */
async function setPrefix(guildId, prefix) {
    const { error } = await supabase
        .from("guilds")
        .upsert({ id: guildId, prefix }, { onConflict: "id" });

    if (error) throw error;

    const current = cache.get(guildId);
    setCache(guildId, {
        prefix,
        music_channel_id: current?.musicChannelId || null
    });

    return prefix;
}

/**
 * @param {string} guildId
 * @param {string|null} channelId
 */
async function setMusicChannel(guildId, channelId) {
    const { error } = await supabase
        .from("guilds")
        .upsert({ id: guildId, music_channel_id: channelId || null }, { onConflict: "id" });

    if (error) throw error;

    const current = cache.get(guildId);
    setCache(guildId, {
        prefix: current?.prefix || cfg.defaults.prefix,
        music_channel_id: channelId || null
    });

    return channelId || null;
}

module.exports = {
    getPrefix,
    setPrefix,
    ensureGuild,
    getMusicChannel,
    setMusicChannel
};
