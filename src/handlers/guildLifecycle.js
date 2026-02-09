const { PermissionsBitField, ChannelType } = require("discord.js");
const { ensureGuild } = require("../database/guildConfig");
const { createContainer } = require("../components/containerBuilder");

function fmtDate(value) {
    if (!value) return "Unknown";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Unknown";
    return d.toUTCString();
}

async function resolveGuildInvite(guild) {
    try {
        const vanityCode = guild.vanityURLCode || (await guild.fetchVanityData().then((d) => d?.code).catch(() => null));
        if (vanityCode) return `https://discord.gg/${vanityCode}`;
    } catch {}

    try {
        const invites = await guild.invites.fetch();
        const first = invites?.first?.();
        if (first?.url) return first.url;
    } catch {}

    try {
        const botId = guild.client.user?.id;
        if (!botId) return "Not available (missing bot user).";

        const targetChannel = guild.channels.cache
            .filter((ch) =>
                ch.type === ChannelType.GuildText &&
                ch.viewable &&
                ch.permissionsFor(botId)?.has(PermissionsBitField.Flags.CreateInstantInvite)
            )
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .first();

        if (!targetChannel) return "Not available (no invite permission).";

        const invite = await targetChannel.createInvite({
            maxAge: 0,
            maxUses: 0,
            unique: false,
            reason: "Hima guild join log invite snapshot"
        });

        return invite?.url || "Not available.";
    } catch {
        return "Not available (cannot create invite).";
    }
}

function buildGuildPayload(type, guild, inviteUrl = null) {
    const isJoin = type === "join";
    const icon = guild.iconURL?.({ extension: "png", size: 1024 }) || null;

    const sections = [
        { title: "Server", content: `${guild.name} (ID: ${guild.id})` },
        { title: "Owner", content: guild.ownerId ? `<@${guild.ownerId}>` : "Unknown" },
        { title: "Members", content: String(guild.memberCount ?? "Unknown") },
        { title: "Created", content: fmtDate(guild.createdAt) },
        { title: "Shard", content: String(guild.shardId ?? 0) },
        { title: "Boost Level", content: `Tier ${guild.premiumTier ?? 0}` },
        { title: "Boost Count", content: String(guild.premiumSubscriptionCount ?? 0) }
    ];

    if (guild.joinedAt) {
        sections.push({ title: "Joined Bot At", content: fmtDate(guild.joinedAt) });
    }

    if (isJoin) {
        sections.push({ title: "Invite", content: inviteUrl || "Not available." });
    }

    return {
        title: isJoin ? "Joined New Server" : "Left Server",
        description: isJoin
            ? "Hima has been added to a new guild."
            : "Hima has been removed from a guild.",
        sections,
        media: icon,
        footer: `Total Guilds: ${guild.client.guilds.cache.size}`
    };
}

async function sendGuildLifecycleLog(bot, type, guild) {
    const channelId = bot.config?.guildLogs?.channelId;
    if (!channelId) return;

    const channel = await bot.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const inviteUrl = type === "join" ? await resolveGuildInvite(guild) : null;
    const payload = buildGuildPayload(type, guild, inviteUrl);

    await channel.send(createContainer(payload)).catch((error) => {
        console.error(`[Guild ${type} Log Error]`, error?.message || error);
    });
}

function registerGuildLifecycleHandler(bot) {
    bot.client.on("guildCreate", async (guild) => {
        await ensureGuild(guild.id).catch((err) => {
            console.error("[guildCreate ensureGuild]", err);
        });

        await sendGuildLifecycleLog(bot, "join", guild);
    });

    bot.client.on("guildDelete", async (guild) => {
        await sendGuildLifecycleLog(bot, "leave", guild);
    });
}

module.exports = { registerGuildLifecycleHandler };
