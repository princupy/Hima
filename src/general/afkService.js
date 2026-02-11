const { buildContainerMessage, COMPONENTS_V2_FLAG } = require("../components/containerBuilder");
const {
    clearAllAfkForUser,
    clearGlobalAfk,
    clearGuildAfk,
    getEffectiveAfk,
    getAfkStatusesForUsers,
    setGlobalAfk,
    setGuildAfk,
    saveAfkOriginalNick,
    getAfkNick,
    listAfkNicksByUser,
    clearAfkNick,
    clearAllAfkNicksByUser
} = require("../database/afk");

function toUnix(ts) {
    const ms = new Date(ts || 0).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.floor(ms / 1000);
}

function extractMentionTargets(message) {
    const ids = new Set();

    for (const user of message.mentions?.users?.values?.() || []) {
        if (user?.id) ids.add(user.id);
    }

    const replied = message.mentions?.repliedUser;
    if (replied?.id) ids.add(replied.id);

    ids.delete(message.author.id);
    return Array.from(ids);
}

function makeAfkNick(displayName) {
    const base = String(displayName || "User").trim();
    if (base.toLowerCase().startsWith("[afk]")) return base.slice(0, 32);
    return `[AFK] ${base}`.slice(0, 32);
}

async function applyAfkNickForMember(member) {
    if (!member || !member.manageable) return false;

    const current = member.displayName || member.user?.username || "User";
    const target = makeAfkNick(current);
    if (current === target) return false;

    const existing = await getAfkNick(member.guild.id, member.id).catch(() => null);
    if (!existing) {
        await saveAfkOriginalNick(member.guild.id, member.id, member.nickname || null).catch(() => null);
    }

    await member.setNickname(target, "AFK enabled").catch(() => null);
    return true;
}

async function applyAfkNickInGuild(guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    return applyAfkNickForMember(member);
}

async function applyAfkNickCurrentGuild(message) {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return false;
    return applyAfkNickForMember(member);
}

async function applyAfkNickAllMutualGuilds(bot, userId) {
    const guilds = Array.from(bot.client.guilds.cache.values());
    for (const guild of guilds) {
        await applyAfkNickInGuild(guild, userId);
    }
}

async function restoreAfkNickForGuild(guild, userId) {
    const row = await getAfkNick(guild.id, userId).catch(() => null);
    if (!row) return false;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && member.manageable) {
        const nextNick = row.original_nick || null;
        await member.setNickname(nextNick, "AFK disabled").catch(() => null);
    }

    await clearAfkNick(guild.id, userId).catch(() => null);
    return true;
}

async function restoreAllAfkNicks(bot, userId) {
    const rows = await listAfkNicksByUser(userId).catch(() => []);
    for (const row of rows) {
        const guild = await bot.client.guilds.fetch(row.guild_id).catch(() => null);
        if (!guild) continue;
        await restoreAfkNickForGuild(guild, userId);
    }
    await clearAllAfkNicksByUser(userId).catch(() => null);
}

async function disableAfk(bot, { guildId, userId, scope = "all" }) {
    if (scope === "server") {
        await clearGuildAfk(guildId, userId).catch(() => null);
        const guild = await bot.client.guilds.fetch(guildId).catch(() => null);
        if (guild) await restoreAfkNickForGuild(guild, userId);
        return;
    }

    if (scope === "global") {
        await clearGlobalAfk(userId).catch(() => null);
        await restoreAllAfkNicks(bot, userId);
        return;
    }

    await clearAllAfkForUser(guildId, userId).catch(() => null);
    await restoreAllAfkNicks(bot, userId);
}

async function enableAfk(bot, message, { scope, reason }) {
    const textReason = String(reason || "I am currently away.").trim();

    if (scope === "global") {
        const entry = await setGlobalAfk(message.author.id, textReason);
        await applyAfkNickAllMutualGuilds(bot, message.author.id);
        return entry;
    }

    const entry = await setGuildAfk(message.guild.id, message.author.id, textReason);
    await applyAfkNickCurrentGuild(message);
    return entry;
}

function buildAfkClearPayload() {
    return buildContainerMessage({
        title: "AFK Removed",
        description: "Welcome back. Your AFK status is now cleared and nickname restored.",
        footer: "You can set again with afk"
    });
}

function buildAfkDmPayload({ guildName, channelName, byUserId, reason, content, messageUrl }) {
    const preview = String(content || "").trim().slice(0, 400) || "No message preview";
    return buildContainerMessage({
        title: "AFK Update",
        description: "Someone pinged/replied to you while you were AFK.",
        fields: [
            { name: "By", value: `<@${byUserId}>` },
            { name: "Server", value: guildName || "Unknown" },
            { name: "Channel", value: channelName ? `#${channelName}` : "Unknown" },
            { name: "Your AFK Reason", value: reason || "AFK" },
            { name: "Message Preview", value: preview },
            ...(messageUrl ? [{ name: "Jump To Message", value: `[Open Message](${messageUrl})` }] : [])
        ],
        footer: "Turn on DMs to always receive AFK alerts"
    });
}

async function buildAfkNoticePayload(bot, statuses) {
    const components = [
        { type: 10, content: "## AFK Notice" },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "Mentioned user is currently AFK." }
    ];

    for (const entry of statuses.slice(0, 8)) {
        const user = await bot.client.users.fetch(entry.userId).catch(() => null);
        const sinceUnix = toUnix(entry.setAt);
        const sinceText = sinceUnix ? `<t:${sinceUnix}:F>\n<t:${sinceUnix}:R>` : "Unknown";
        const body = `**<@${entry.userId}>**\nScope: ${entry.scope === "server" ? "Server AFK" : "Global AFK"}\nReason: ${entry.reason || "AFK"}\nSince: ${sinceText}`;

        components.push({
            type: 9,
            components: [{ type: 10, content: body }],
            ...(user
                ? {
                    accessory: {
                        type: 11,
                        media: { url: user.displayAvatarURL({ extension: "png", size: 256 }) }
                    }
                }
                : {})
        });

        components.push({ type: 14, divider: true, spacing: 1 });
    }

    components.push({ type: 10, content: statuses.length > 8 ? `Showing 8/${statuses.length}` : "AFK system" });

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [{ type: 17, components }]
    };
}

async function notifyAfkUsers(bot, message, statuses) {
    for (const status of statuses) {
        try {
            const target = await bot.client.users.fetch(status.userId).catch(() => null);
            if (!target) continue;

            await target.send(buildAfkDmPayload({
                guildName: message.guild?.name,
                channelName: message.channel?.name,
                byUserId: message.author.id,
                reason: status.reason,
                content: message.content,
                messageUrl: message.url
            })).catch(() => null);
        } catch {
            // Ignore DM failures
        }
    }
}

async function processAfkMentions(bot, message) {
    const targetIds = extractMentionTargets(message);
    if (!targetIds.length) return false;

    const mapped = await getAfkStatusesForUsers(message.guild.id, targetIds);
    const statuses = targetIds.map((id) => mapped.get(id)).filter(Boolean);

    if (!statuses.length) return false;

    const payload = await buildAfkNoticePayload(bot, statuses);
    await message.reply(payload).catch(() => null);
    await notifyAfkUsers(bot, message, statuses);
    return true;
}

async function clearAuthorAfkIfNeeded(bot, message, skip) {
    if (skip) return false;

    const active = await getEffectiveAfk(message.guild.id, message.author.id).catch(() => null);
    if (!active) return false;

    await disableAfk(bot, {
        guildId: message.guild.id,
        userId: message.author.id,
        scope: active.scope === "global" ? "global" : "server"
    });

    await message.reply(buildAfkClearPayload()).catch(() => null);
    return true;
}

module.exports = {
    processAfkMentions,
    clearAuthorAfkIfNeeded,
    enableAfk,
    disableAfk
};


