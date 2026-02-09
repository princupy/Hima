const { PermissionFlagsBits } = require("discord.js");
const {
    isGuildAnyPremiumActive,
    getGuild247Settings,
    setGuild247Settings
} = require("./profile");
const { voteUrl, buyUrl } = require("./service");

async function ensureJoined(bot, message, voiceChannel) {
    const guildId = message.guildId;
    const state = bot.music.get(guildId);

    if (!state) {
        await bot.music.create(
            guildId,
            voiceChannel.id,
            message.channelId,
            message.guild.shardId || 0,
            message.author.id
        );
        return true;
    }

    if (state.voiceChannelId !== voiceChannel.id) {
        await bot.music.disconnect(guildId).catch(() => null);
        await bot.music.create(
            guildId,
            voiceChannel.id,
            message.channelId,
            message.guild.shardId || 0,
            message.author.id
        );
        return true;
    }

    return false;
}

module.exports = {
    name: "247",
    aliases: ["alwayson", "stayvc"],
    description: "Toggle 24/7 voice stay mode (guild admin + premium required).",
    usage: "247 <on|off|status>",
    async execute({ bot, message, args, reply }) {
        if (!message.guildId || !message.guild) {
            await reply({ title: "Guild Only", description: "Use this command in a server." });
            return;
        }

        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        const isAdmin = Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
        if (!isAdmin) {
            await reply({
                title: "Permission Required",
                description: "You need **Manage Server** permission to use 24/7 mode."
            });
            return;
        }

        const sub = String(args[0] || "status").toLowerCase();

        if (sub === "status") {
            const st = await getGuild247Settings(message.guildId).catch(() => null);
            await reply({
                title: "24/7 Status",
                description: "Current always-on voice status for this server.",
                fields: [
                    { name: "Premium Active", value: st?.premiumActive ? "Yes" : "No" },
                    { name: "Mode", value: st?.enabled ? "ON" : "OFF" },
                    { name: "Voice Channel", value: st?.channelId ? `<#${st.channelId}>` : "Not set" }
                ],
                footer: "Use 247 on/off"
            });
            return;
        }

        if (sub === "on") {
            const premiumActive = await isGuildAnyPremiumActive(message.guildId).catch(() => false);
            if (!premiumActive) {
                await message.reply({
                    flags: 1 << 15,
                    components: [
                        {
                            type: 17,
                            components: [
                                { type: 10, content: "## Premium Required" },
                                { type: 14, divider: true, spacing: 1 },
                                { type: 10, content: "24/7 mode requires active vote premium or buy premium." },
                                {
                                    type: 1,
                                    components: [
                                        { type: 2, style: 5, label: "Vote Premium", url: voteUrl(bot) },
                                        { type: 2, style: 5, label: "Buy Premium", url: buyUrl() }
                                    ]
                                }
                            ]
                        }
                    ]
                });
                return;
            }

            const voice = member?.voice?.channel;
            if (!voice) {
                await reply({
                    title: "Join Voice First",
                    description: "Pehle kisi voice channel me join karo, phir `247 on` use karo."
                });
                return;
            }

            await ensureJoined(bot, message, voice).catch(() => null);

            await setGuild247Settings(message.guildId, {
                enabled: true,
                channelId: voice.id,
                userId: message.author.id
            });

            await reply({
                title: "24/7 Enabled",
                description: `Bot will stay connected in <#${voice.id}> while premium is active.`,
                footer: "If premium expires, 24/7 turns off automatically"
            });
            return;
        }

        if (sub === "off") {
            await setGuild247Settings(message.guildId, {
                enabled: false,
                channelId: null,
                userId: message.author.id
            });

            const state = bot.music.get(message.guildId);
            if (state && !state.current && state.queue.length === 0) {
                await bot.music.disconnect(message.guildId).catch(() => null);
            }

            await reply({
                title: "24/7 Disabled",
                description: "Always-on voice mode is now off."
            });
            return;
        }

        await reply({
            title: "Invalid Option",
            description: "Usage: 247 <on|off|status>"
        });
    }
};



