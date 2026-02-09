const { supabase } = require("./supabase");

const MAX_REASON_LENGTH = 200;

function sanitizeReason(value) {
    const raw = String(value || "").trim();
    if (!raw) return "AFK";
    return raw.length > MAX_REASON_LENGTH ? `${raw.slice(0, MAX_REASON_LENGTH - 3)}...` : raw;
}

function fromRow(row, scope) {
    if (!row) return null;
    return {
        scope,
        userId: row.user_id,
        guildId: row.guild_id || null,
        reason: row.reason || "AFK",
        setAt: row.set_at || row.updated_at || row.created_at || null
    };
}

async function setGlobalAfk(userId, reason) {
    const payload = {
        user_id: userId,
        reason: sanitizeReason(reason),
        set_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from("afk_global")
        .upsert(payload, { onConflict: "user_id" })
        .select("*")
        .single();

    if (error) throw error;
    return fromRow(data, "global");
}

async function setGuildAfk(guildId, userId, reason) {
    const payload = {
        guild_id: guildId,
        user_id: userId,
        reason: sanitizeReason(reason),
        set_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from("afk_guild")
        .upsert(payload, { onConflict: "guild_id,user_id" })
        .select("*")
        .single();

    if (error) throw error;
    return fromRow(data, "server");
}

async function clearGlobalAfk(userId) {
    const { error } = await supabase
        .from("afk_global")
        .delete()
        .eq("user_id", userId);

    if (error) throw error;
}

async function clearGuildAfk(guildId, userId) {
    const { error } = await supabase
        .from("afk_guild")
        .delete()
        .eq("guild_id", guildId)
        .eq("user_id", userId);

    if (error) throw error;
}

async function clearAllAfkForUser(guildId, userId) {
    await Promise.all([
        clearGlobalAfk(userId),
        clearGuildAfk(guildId, userId)
    ]);
}

async function getGlobalAfk(userId) {
    const { data, error } = await supabase
        .from("afk_global")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    return fromRow(data, "global");
}

async function getGuildAfk(guildId, userId) {
    const { data, error } = await supabase
        .from("afk_guild")
        .select("*")
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    return fromRow(data, "server");
}

async function getEffectiveAfk(guildId, userId) {
    const [server, global] = await Promise.all([
        getGuildAfk(guildId, userId),
        getGlobalAfk(userId)
    ]);

    return server || global || null;
}

async function getAfkStatusesForUsers(guildId, userIds) {
    const ids = Array.from(new Set((userIds || []).filter(Boolean)));
    if (!ids.length) return new Map();

    const [guildRes, globalRes] = await Promise.all([
        supabase
            .from("afk_guild")
            .select("*")
            .eq("guild_id", guildId)
            .in("user_id", ids),
        supabase
            .from("afk_global")
            .select("*")
            .in("user_id", ids)
    ]);

    if (guildRes.error) throw guildRes.error;
    if (globalRes.error) throw globalRes.error;

    const out = new Map();

    for (const row of globalRes.data || []) {
        out.set(row.user_id, fromRow(row, "global"));
    }

    for (const row of guildRes.data || []) {
        out.set(row.user_id, fromRow(row, "server"));
    }

    return out;
}

async function saveAfkOriginalNick(guildId, userId, originalNick) {
    const payload = {
        guild_id: guildId,
        user_id: userId,
        original_nick: originalNick || null,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from("afk_nicknames")
        .upsert(payload, { onConflict: "guild_id,user_id" });

    if (error) throw error;
}

async function getAfkNick(guildId, userId) {
    const { data, error } = await supabase
        .from("afk_nicknames")
        .select("*")
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function listAfkNicksByUser(userId) {
    const { data, error } = await supabase
        .from("afk_nicknames")
        .select("*")
        .eq("user_id", userId);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

async function clearAfkNick(guildId, userId) {
    const { error } = await supabase
        .from("afk_nicknames")
        .delete()
        .eq("guild_id", guildId)
        .eq("user_id", userId);

    if (error) throw error;
}

async function clearAllAfkNicksByUser(userId) {
    const { error } = await supabase
        .from("afk_nicknames")
        .delete()
        .eq("user_id", userId);

    if (error) throw error;
}

module.exports = {
    setGlobalAfk,
    setGuildAfk,
    clearGlobalAfk,
    clearGuildAfk,
    clearAllAfkForUser,
    getGlobalAfk,
    getGuildAfk,
    getEffectiveAfk,
    getAfkStatusesForUsers,
    saveAfkOriginalNick,
    getAfkNick,
    listAfkNicksByUser,
    clearAfkNick,
    clearAllAfkNicksByUser
};
