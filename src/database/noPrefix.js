const { supabase } = require("./supabase");

const CACHE_TTL_MS = 60 * 1000;
const activeCache = new Map();

function nowIso() {
    return new Date().toISOString();
}

function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function cacheSet(userId, row) {
    activeCache.set(userId, {
        value: row,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

function cacheDelete(userId) {
    activeCache.delete(userId);
}

function parseDurationValue(value) {
    if (value === "permanent") return null;
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.floor(ms);
}

async function setNoPrefixUser({ userId, addedBy, addedGuildId, addedChannelId, durationMs }) {
    const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;

    const payload = {
        user_id: userId,
        is_active: true,
        expires_at: expiresAt,
        added_by: addedBy,
        added_guild_id: addedGuildId,
        added_channel_id: addedChannelId,
        created_at: nowIso(),
        updated_at: nowIso()
    };

    const { data, error } = await supabase
        .from("no_prefix_users")
        .upsert(payload, { onConflict: "user_id" })
        .select("*")
        .single();

    if (error) throw error;

    cacheSet(userId, data);
    return data;
}

async function removeNoPrefixUser(userId, removedBy = null) {
    const update = {
        is_active: false,
        expires_at: null,
        updated_at: nowIso()
    };

    if (removedBy) update.removed_by = removedBy;

    const { data, error } = await supabase
        .from("no_prefix_users")
        .update(update)
        .eq("user_id", userId)
        .eq("is_active", true)
        .select("*")
        .maybeSingle();

    if (error) throw error;

    cacheDelete(userId);
    return data;
}

async function getNoPrefixRow(userId) {
    const { data, error } = await supabase
        .from("no_prefix_users")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function isNoPrefixActive(userId) {
    const cached = activeCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
        const row = cached.value;
        if (!row || !row.is_active) return false;
        const expiresAt = toDate(row.expires_at);
        if (expiresAt && expiresAt.getTime() <= Date.now()) return false;
        return true;
    }

    const row = await getNoPrefixRow(userId).catch(() => null);
    if (!row || !row.is_active) {
        cacheSet(userId, null);
        return false;
    }

    const expiresAt = toDate(row.expires_at);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
        cacheSet(userId, null);
        return false;
    }

    cacheSet(userId, row);
    return true;
}

async function getActiveNoPrefixUsers(limit = 100) {
    const { data, error } = await supabase
        .from("no_prefix_users")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data || [];
}

async function getExpiredActiveNoPrefixUsers() {
    const { data, error } = await supabase
        .from("no_prefix_users")
        .select("*")
        .eq("is_active", true)
        .not("expires_at", "is", null)
        .lte("expires_at", nowIso());

    if (error) throw error;
    return data || [];
}

async function markExpiredNoPrefixUser(userId) {
    const { data, error } = await supabase
        .from("no_prefix_users")
        .update({
            is_active: false,
            updated_at: nowIso(),
            removed_by: "SYSTEM_EXPIRE"
        })
        .eq("user_id", userId)
        .eq("is_active", true)
        .select("*")
        .maybeSingle();

    if (error) throw error;

    cacheDelete(userId);
    return data;
}

module.exports = {
    parseDurationValue,
    setNoPrefixUser,
    removeNoPrefixUser,
    getNoPrefixRow,
    isNoPrefixActive,
    getActiveNoPrefixUsers,
    getExpiredActiveNoPrefixUsers,
    markExpiredNoPrefixUser
};
