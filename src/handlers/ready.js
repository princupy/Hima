const { ActivityType } = require("discord.js");
const { ensureGuild } = require("../database/guildConfig");
const { startNoPrefixExpiryLoop } = require("../services/noPrefixService");
const { listActive247GuildRows } = require("../premium/profile");
const { startVoteExpiryReminderLoop } = require("../premium/voteExpiryReminder");

function pickTextChannelId(guild) {
    if (guild.systemChannel && guild.systemChannel.isTextBased()) return guild.systemChannel.id;

    const ch = guild.channels.cache.find((c) => c.isTextBased() && c.viewable);
    return ch?.id || null;
}

async function boot247(bot) {
    const rows = await listActive247GuildRows().catch(() => []);
    for (const row of rows) {
        try {
            const guild = bot.client.guilds.cache.get(row.guild_id)
                || await bot.client.guilds.fetch(row.guild_id).catch(() => null);
            if (!guild) continue;

            const channelId = row.keep_247_channel_id;
            if (!channelId) continue;

            const voice = guild.channels.cache.get(channelId)
                || await guild.channels.fetch(channelId).catch(() => null);
            if (!voice || !voice.isVoiceBased()) continue;

            const textChannelId = pickTextChannelId(guild);
            if (!textChannelId) continue;

            await bot.music.create(guild.id, voice.id, textChannelId, guild.shardId || 0, row.keep_247_by_user_id || null).catch(() => null);
        } catch {}
    }
}

function startActivityLoop(bot) {
    const prefix = bot.config?.defaults?.prefix || "H!";
    const entries = [
        { name: `${prefix}help | Music + Premium`, type: ActivityType.Playing },
        { name: `${prefix}play <song>`, type: ActivityType.Listening },
        { name: `Filters + Queue + 24/7`, type: ActivityType.Watching },
        { name: `Default Prefix: ${prefix}`, type: ActivityType.Playing },
        { name: `Spotify + Lavalink`, type: ActivityType.Listening }
    ];

    let i = 0;
    const apply = () => {
        const item = entries[i % entries.length];
        bot.client.user.setActivity(item.name, { type: item.type });
        i += 1;
    };

    apply();
    const timer = setInterval(apply, 20_000);
    if (typeof timer.unref === "function") timer.unref();
}

function registerReadyHandler(bot) {
    bot.client.once("clientReady", async () => {
        console.log(`Logged in as ${bot.client.user.tag}`);
        bot.music.init(bot.client.user.id);

        for (const guild of bot.client.guilds.cache.values()) {
            await ensureGuild(guild.id).catch((err) => {
                console.error(`[ensureGuild:${guild.id}]`, err);
            });
        }

        await boot247(bot);
        startNoPrefixExpiryLoop(bot);
        startVoteExpiryReminderLoop(bot);
        startActivityLoop(bot);
    });
}

module.exports = { registerReadyHandler };
