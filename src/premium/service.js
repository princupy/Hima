const crypto = require("node:crypto");
const { supabase } = require("../database/supabase");
const {
    isActiveVote,
    getUserPremiumRow,
    activateUserVotePremium,
    isVotePremiumActive,
    setUserPrefix,
    activateGuildVotePremium,
    getGuildVoteRow,
    isGuildVotePremiumActive,
    setGuildCardTheme,
    getActiveGuildCardTheme,
    activateGuildPaidPremium,
    isGuildPaidPremiumActive,
    isGuildAnyPremiumActive
} = require("./profile");
const { hasVotedOnTopGG } = require("./topgg");

const ALLOWED_THEMES = new Set(["ease", "glass", "neon", "sunset", "ocean", "mono"]);
const TOKEN_PLANS = [
    { key: "1w", label: "1 Week", days: 7, priceInr: 99 },
    { key: "1m", label: "1 Month", days: 30, priceInr: 299 },
    { key: "6m", label: "6 Months", days: 180, priceInr: 1499 },
    { key: "1y", label: "1 Year", days: 365, priceInr: 2499 },
    { key: "permanent", label: "Permanent", days: null, priceInr: 4999 }
];

function normalizeTheme(input) {
    const value = String(input || "").trim().toLowerCase();
    return ALLOWED_THEMES.has(value) ? value : null;
}

function normalizePrefix(input) {
    const v = String(input || "").trim();
    if (!v) return null;
    if (v.length > 5) return null;
    if (/\s/.test(v)) return null;
    return v;
}

function voteUrl(bot) {
    const custom = process.env.TOPGG_VOTE_URL;
    if (custom) return custom;
    const id = bot.client.user?.id;
    return id ? `https://top.gg/bot/${id}/vote` : "https://top.gg";
}

function buyUrl() {
    return process.env.PREMIUM_BUY_URL || "https://discord.gg/37WBxRXVq5";
}

function getPlan(planKey) {
    return TOKEN_PLANS.find((x) => x.key === planKey) || null;
}

function makeTokenCode() {
    const raw = crypto.randomBytes(12).toString("hex").toUpperCase();
    return `HIMA-${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}`;
}

async function sendVoteLog(bot, result) {
    const channelId = bot.config?.premium?.voteLogChannelId;
    if (!channelId) return;

    const channel = await bot.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const parts = [
        "**Premium Vote Synced**",
        `User: <@${result.userId}> (${result.userId})`,
        `User Premium Until: <t:${Math.floor(new Date(result.userUntil).getTime() / 1000)}:F>`
    ];

    if (result.guildId && result.guildUntil) {
        parts.push(`Guild: ${result.guildId}`);
        parts.push(`Guild Premium Until: <t:${Math.floor(new Date(result.guildUntil).getTime() / 1000)}:F>`);
        parts.push(`Guild Theme: ${result.guildTheme || "ease"}`);
    }

    await channel.send({
        allowedMentions: { parse: [] },
        content: parts.join("\n")
    }).catch(() => null);
}

async function sendRedeemLog(bot, payload) {
    const channelId = bot.config?.premium?.voteLogChannelId;
    if (!channelId) return;

    const channel = await bot.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const lines = [
        "**Premium Token Redeemed**",
        `Guild: ${payload.guildId}`,
        `Redeemed By: <@${payload.userId}> (${payload.userId})`,
        `Plan: ${payload.planLabel} (INR ${payload.priceInr})`
    ];

    if (payload.until) {
        lines.push(`Premium Until: <t:${Math.floor(new Date(payload.until).getTime() / 1000)}:F>`);
    } else {
        lines.push("Premium Until: Permanent");
    }

    await channel.send({
        allowedMentions: { parse: [] },
        content: lines.join("\n")
    }).catch(() => null);
}

async function syncVotePremium(bot, { userId, guildId, canManageGuild }) {
    const token = bot.config?.premium?.topggToken;
    const voted = await hasVotedOnTopGG(bot.client.user?.id, userId, token);
    if (!voted) {
        const active = await isVotePremiumActive(userId);
        const guildActive = guildId ? await isGuildVotePremiumActive(guildId) : false;
        return { voted: false, userActive: active, guildActive, voteUrl: voteUrl(bot), buyUrl: buyUrl() };
    }

    const hours = Number(bot.config?.premium?.voteHours || 12);
    const userRow = await activateUserVotePremium(userId, hours, "topgg");

    let guildRow = null;
    if (guildId && canManageGuild) {
        guildRow = await activateGuildVotePremium(guildId, userId, hours, "topgg");
    }

    const result = {
        voted: true,
        userActive: isActiveVote(userRow),
        userUntil: userRow.vote_until,
        userRow,
        guildActive: Boolean(guildRow && isActiveVote(guildRow)),
        guildUntil: guildRow?.vote_until || null,
        guildTheme: guildRow?.musicard_theme || "ease",
        guildRow,
        userId,
        guildId: guildId || null
    };

    await sendVoteLog(bot, result);
    return result;
}

async function setPremiumUserPrefix(userId, prefix) {
    const normalized = normalizePrefix(prefix);
    if (!normalized) throw new Error("Prefix must be 1-5 chars, no spaces.");
    await setUserPrefix(userId, normalized);
    return normalized;
}

async function setGuildMusicardTheme(guildId, theme) {
    const normalized = normalizeTheme(theme);
    if (!normalized) throw new Error("Theme must be one of: ease, glass, neon, sunset, ocean, mono");
    await setGuildCardTheme(guildId, normalized);
    return normalized;
}

async function createPremiumToken({ ownerId, durationKey }) {
    const plan = getPlan(durationKey);
    if (!plan) throw new Error("Invalid premium plan.");

    const token = makeTokenCode();
    const payload = {
        token,
        duration_key: plan.key,
        duration_days: plan.days,
        is_permanent: plan.key === "permanent",
        price_inr: plan.priceInr,
        created_by: ownerId,
        created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from("premium_tokens")
        .insert(payload)
        .select("*")
        .single();

    if (error) throw error;
    return { row: data, plan };
}

async function redeemPremiumToken({ bot, token, guildId, userId }) {
    const code = String(token || "").trim().toUpperCase();
    if (!code) throw new Error("Token is required.");

    const { data, error } = await supabase
        .from("premium_tokens")
        .select("*")
        .eq("token", code)
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("Invalid token.");
    if (data.redeemed_at) throw new Error("This token is already redeemed.");

    const plan = getPlan(data.duration_key);
    if (!plan) throw new Error("Token plan is invalid.");

    const updatedGuild = await activateGuildPaidPremium(guildId, userId, {
        isPermanent: Boolean(data.is_permanent),
        days: data.duration_days,
        source: "token",
        tokenId: data.token
    });

    const { error: updateErr } = await supabase
        .from("premium_tokens")
        .update({
            redeemed_at: new Date().toISOString(),
            redeemed_by_user_id: userId,
            redeemed_guild_id: guildId
        })
        .eq("token", code)
        .is("redeemed_at", null);

    if (updateErr) throw updateErr;

    await sendRedeemLog(bot, {
        guildId,
        userId,
        planLabel: plan.label,
        priceInr: data.price_inr,
        until: updatedGuild.premium_is_permanent ? null : updatedGuild.premium_until
    });

    return {
        plan,
        priceInr: data.price_inr,
        guild: updatedGuild
    };
}

module.exports = {
    normalizeTheme,
    normalizePrefix,
    voteUrl,
    buyUrl,
    TOKEN_PLANS,
    getPlan,
    syncVotePremium,
    setPremiumUserPrefix,
    setGuildMusicardTheme,
    createPremiumToken,
    redeemPremiumToken,
    getUserPremiumRow,
    getGuildVoteRow,
    getActiveGuildCardTheme,
    isGuildPaidPremiumActive,
    isGuildAnyPremiumActive
};
