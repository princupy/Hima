const { supabase } = require("../database/supabase");

const CACHE_TTL_MS = 60 * 1000;
const userCache = new Map();
const guildCache = new Map();

function nowIso() {
    return new Date().toISOString();
}

function toDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function isActiveVote(row) {
    const until = toDate(row?.vote_until);
    return Boolean(until && until.getTime() > Date.now());
}

function isGuildPaidPremiumActive(row) {
    if (!row) return false;
    if (row.premium_is_permanent) return true;
    const until = toDate(row.premium_until);
    return Boolean(until && until.getTime() > Date.now());
}

function isGuildAnyPremiumRowActive(row) {
    return isActiveVote(row) || isGuildPaidPremiumActive(row);
}

function cacheSet(cache, id, row) {
    cache.set(id, {
        value: row,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
}

function cacheGet(cache, id) {
    const cached = cache.get(id);
    if (!cached || cached.expiresAt <= Date.now()) return null;
    return cached.value;
}

function cacheDelete(userId, guildId) {
    if (userId) userCache.delete(userId);
    if (guildId) guildCache.delete(guildId);
}

async function getUserPremiumRow(userId) {
    const cached = cacheGet(userCache, userId);
    if (cached !== null) return cached;

    const { data, error } = await supabase
        .from("user_premium_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;
    const row = data || null;
    cacheSet(userCache, userId, row);
    return row;
}

async function ensureUserPremiumRow(userId) {
    const existing = await getUserPremiumRow(userId);
    if (existing) return existing;

    const payload = {
        user_id: userId,
        vote_until: null,
        custom_prefix: null,
        vote_expiry_notified_at: null,
        created_at: nowIso(),
        updated_at: nowIso()
    };

    const { data, error } = await supabase
        .from("user_premium_profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select("*")
        .single();

    if (error) throw error;
    cacheSet(userCache, userId, data);
    return data;
}

async function updateUserPremium(userId, patch) {
    const base = await ensureUserPremiumRow(userId);
    const payload = {
        ...patch,
        updated_at: nowIso()
    };

    const { data, error } = await supabase
        .from("user_premium_profiles")
        .update(payload)
        .eq("user_id", userId)
        .select("*")
        .single();

    if (error) throw error;
    cacheSet(userCache, userId, data || { ...base, ...payload });
    return data;
}

async function activateUserVotePremium(userId, durationHours, source = "topgg") {
    const row = await ensureUserPremiumRow(userId);
    const currentUntil = toDate(row.vote_until);
    const freshUntil = Date.now() + durationHours * 60 * 60 * 1000;
    const nextMs = currentUntil && currentUntil.getTime() > Date.now()
        ? Math.max(currentUntil.getTime(), freshUntil)
        : freshUntil;

    return updateUserPremium(userId, {
        vote_until: new Date(nextMs).toISOString(),
        vote_expiry_notified_at: null,
        last_vote_at: nowIso(),
        last_vote_source: source
    });
}

async function isVotePremiumActive(userId) {
    const row = await getUserPremiumRow(userId).catch(() => null);
    if (!row) return false;
    return isActiveVote(row);
}

async function hasUserPaidPremiumAccess(userId) {
    const now = nowIso();
    const { data, error } = await supabase
        .from("guild_vote_premium")
        .select("guild_id")
        .eq("premium_by_user_id", userId)
        .or(`premium_is_permanent.eq.true,premium_until.gt.${now}`)
        .limit(1);

    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
}

async function getActiveUserPrefix(userId) {
    const row = await getUserPremiumRow(userId).catch(() => null);
    if (!row) return null;

    const voteActive = isActiveVote(row);
    const paidActive = await hasUserPaidPremiumAccess(userId).catch(() => false);
    if (!voteActive && !paidActive) return null;

    return row.custom_prefix || null;
}

async function setUserPrefix(userId, prefix) {
    return updateUserPremium(userId, { custom_prefix: prefix });
}

async function listExpiredVoteUsersForNotify(limit = 100) {
    const { data, error } = await supabase
        .from("user_premium_profiles")
        .select("user_id, vote_until, vote_expiry_notified_at")
        .not("vote_until", "is", null)
        .lte("vote_until", nowIso())
        .order("vote_until", { ascending: true })
        .limit(limit);

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    return rows.filter((row) => {
        const until = toDate(row.vote_until);
        if (!until) return false;

        const notifiedAt = toDate(row.vote_expiry_notified_at);
        return !notifiedAt || notifiedAt.getTime() < until.getTime();
    });
}

async function markVoteExpiryNotified(userId, voteUntil) {
    return updateUserPremium(userId, {
        vote_expiry_notified_at: new Date().toISOString(),
        vote_until: voteUntil || null
    });
}

async function getGuildVoteRow(guildId) {
    const cached = cacheGet(guildCache, guildId);
    if (cached !== null) return cached;

    const { data, error } = await supabase
        .from("guild_vote_premium")
        .select("*")
        .eq("guild_id", guildId)
        .maybeSingle();

    if (error) throw error;
    const row = data || null;
    cacheSet(guildCache, guildId, row);
    return row;
}

async function ensureGuildVoteRow(guildId) {
    const existing = await getGuildVoteRow(guildId);
    if (existing) return existing;

    const payload = {
        guild_id: guildId,
        vote_until: null,
        musicard_theme: "ease",
        voter_user_id: null,
        premium_until: null,
        premium_is_permanent: false,
        premium_by_user_id: null,
        premium_source: null,
        premium_token_id: null,
        keep_247_enabled: false,
        keep_247_channel_id: null,
        keep_247_by_user_id: null,
        keep_247_updated_at: null,
        created_at: nowIso(),
        updated_at: nowIso()
    };

    const { data, error } = await supabase
        .from("guild_vote_premium")
        .upsert(payload, { onConflict: "guild_id" })
        .select("*")
        .single();

    if (error) throw error;
    cacheSet(guildCache, guildId, data);
    return data;
}

async function updateGuildVoteRow(guildId, patch) {
    const base = await ensureGuildVoteRow(guildId);
    const payload = {
        ...patch,
        updated_at: nowIso()
    };

    const { data, error } = await supabase
        .from("guild_vote_premium")
        .update(payload)
        .eq("guild_id", guildId)
        .select("*")
        .single();

    if (error) throw error;
    cacheSet(guildCache, guildId, data || { ...base, ...payload });
    return data;
}

async function activateGuildVotePremium(guildId, userId, durationHours, source = "topgg") {
    const row = await ensureGuildVoteRow(guildId);
    const currentUntil = toDate(row.vote_until);
    const freshUntil = Date.now() + durationHours * 60 * 60 * 1000;
    const nextMs = currentUntil && currentUntil.getTime() > Date.now()
        ? Math.max(currentUntil.getTime(), freshUntil)
        : freshUntil;

    return updateGuildVoteRow(guildId, {
        vote_until: new Date(nextMs).toISOString(),
        voter_user_id: userId,
        last_vote_at: nowIso(),
        last_vote_source: source
    });
}

async function activateGuildPaidPremium(guildId, userId, options) {
    const row = await ensureGuildVoteRow(guildId);
    const now = Date.now();

    if (options.isPermanent) {
        return updateGuildVoteRow(guildId, {
            premium_is_permanent: true,
            premium_until: null,
            premium_by_user_id: userId,
            premium_source: options.source || "token",
            premium_token_id: options.tokenId || null
        });
    }

    const days = Number(options.days || 0);
    if (!Number.isFinite(days) || days <= 0) {
        throw new Error("Invalid premium duration days.");
    }

    const currentUntil = toDate(row.premium_until);
    const baseMs = row.premium_is_permanent
        ? now
        : currentUntil && currentUntil.getTime() > now
            ? currentUntil.getTime()
            : now;

    const nextMs = baseMs + days * 24 * 60 * 60 * 1000;

    return updateGuildVoteRow(guildId, {
        premium_is_permanent: false,
        premium_until: new Date(nextMs).toISOString(),
        premium_by_user_id: userId,
        premium_source: options.source || "token",
        premium_token_id: options.tokenId || null
    });
}

async function isGuildVotePremiumActive(guildId) {
    const row = await getGuildVoteRow(guildId).catch(() => null);
    if (!row) return false;
    return isActiveVote(row);
}

async function isGuildAnyPremiumActive(guildId) {
    const row = await getGuildVoteRow(guildId).catch(() => null);
    return isGuildAnyPremiumRowActive(row);
}

async function getActiveGuildCardTheme(guildId) {
    const row = await getGuildVoteRow(guildId).catch(() => null);
    if (!row || !isGuildAnyPremiumRowActive(row)) return "ease";
    return row.musicard_theme || "ease";
}

async function setGuildCardTheme(guildId, theme) {
    return updateGuildVoteRow(guildId, { musicard_theme: theme });
}

async function getGuild247Settings(guildId) {
    const row = await getGuildVoteRow(guildId).catch(() => null);
    if (!row) {
        return {
            enabled: false,
            configured: false,
            premiumActive: false,
            channelId: null,
            byUserId: null,
            row: null
        };
    }

    const premiumActive = isGuildAnyPremiumRowActive(row);
    const configured = Boolean(row.keep_247_enabled);

    return {
        enabled: configured && premiumActive,
        configured,
        premiumActive,
        channelId: row.keep_247_channel_id || null,
        byUserId: row.keep_247_by_user_id || null,
        row
    };
}

async function setGuild247Settings(guildId, { enabled, channelId = null, userId = null }) {
    return updateGuildVoteRow(guildId, {
        keep_247_enabled: Boolean(enabled),
        keep_247_channel_id: enabled ? (channelId || null) : null,
        keep_247_by_user_id: enabled ? (userId || null) : null,
        keep_247_updated_at: nowIso()
    });
}

async function disableGuild247(guildId) {
    return setGuild247Settings(guildId, { enabled: false });
}

async function listActive247GuildRows() {
    const now = nowIso();
    const { data, error } = await supabase
        .from("guild_vote_premium")
        .select("*")
        .eq("keep_247_enabled", true)
        .or(`vote_until.gt.${now},premium_is_permanent.eq.true,premium_until.gt.${now}`);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

module.exports = {
    isActiveVote,
    isGuildPaidPremiumActive,
    isGuildAnyPremiumRowActive,
    getUserPremiumRow,
    ensureUserPremiumRow,
    updateUserPremium,
    activateUserVotePremium,
    isVotePremiumActive,
    hasUserPaidPremiumAccess,
    getActiveUserPrefix,
    setUserPrefix,
    listExpiredVoteUsersForNotify,
    markVoteExpiryNotified,
    getGuildVoteRow,
    ensureGuildVoteRow,
    updateGuildVoteRow,
    activateGuildVotePremium,
    activateGuildPaidPremium,
    isGuildVotePremiumActive,
    isGuildAnyPremiumActive,
    getActiveGuildCardTheme,
    setGuildCardTheme,
    getGuild247Settings,
    setGuild247Settings,
    disableGuild247,
    listActive247GuildRows,
    cacheDelete
};
