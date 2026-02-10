const { getPrefix, getMusicChannel } = require("../database/guildConfig");
const {
    getGuildVoteRow,
    isActiveVote,
    isGuildPaidPremiumActive,
    isGuildAnyPremiumRowActive,
    getActiveGuildCardTheme,
    getGuild247Settings,
    getGuildAutoplaySettings
} = require("../premium/profile");

function ts(value, style = "F") {
    if (!value) return "Not set";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Invalid date";
    return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}

module.exports = {
    name: "config",
    aliases: [],
    description: "Show current guild bot configuration and premium state.",
    usage: "config",
    async execute({ bot, message, reply }) {
        const guildId = message.guild.id;
        const prefix = await getPrefix(guildId);
        const musicChannel = await getMusicChannel(guildId).catch(() => null);
        const player = bot.music.get(guildId);

        const row = await getGuildVoteRow(guildId).catch(() => null);
        const voteActive = isActiveVote(row);
        const paidActive = isGuildPaidPremiumActive(row);
        const anyPremium = isGuildAnyPremiumRowActive(row);
        const effectiveTheme = await getActiveGuildCardTheme(guildId).catch(() => "ease");

        const keep247 = await getGuild247Settings(guildId).catch(() => ({
            configured: false,
            enabled: false,
            channelId: null,
            byUserId: null
        }));

        const autoplay = await getGuildAutoplaySettings(guildId).catch(() => ({
            configured: false,
            enabled: false,
            premiumActive: false,
            byUserId: null
        }));

        const queueSize = player?.queue?.length || 0;
        const filterLabel = player?.activeFilterLabel || "Off";

        await reply({
            title: "Guild Config",
            description: "Current guild settings, premium status and runtime state.",
            fields: [
                { name: "Prefix", value: `\`${prefix}\`` },
                { name: "Music Channel", value: musicChannel ? `<#${musicChannel}>` : "Not locked" },
                { name: "Any Premium", value: anyPremium ? "Active" : "Inactive" },

                { name: "Vote Premium", value: voteActive ? "Active" : "Inactive" },
                { name: "Vote Until", value: voteActive ? ts(row?.vote_until) : "Not active" },
                { name: "Voted By", value: row?.voter_user_id ? `<@${row.voter_user_id}>` : "N/A" },

                { name: "Buy Premium", value: paidActive ? "Active" : "Inactive" },
                {
                    name: "Buy Until",
                    value: row?.premium_is_permanent
                        ? "Permanent"
                        : (paidActive ? ts(row?.premium_until) : "Not active")
                },
                { name: "Premium By", value: row?.premium_by_user_id ? `<@${row.premium_by_user_id}>` : "N/A" },
                { name: "Premium Source", value: row?.premium_source || "N/A" },

                { name: "Musicard Theme", value: `\`${effectiveTheme}\`` },

                { name: "24/7 Configured", value: keep247.configured ? "Yes" : "No" },
                { name: "24/7 Live", value: keep247.enabled ? "On" : "Off" },
                { name: "24/7 Channel", value: keep247.channelId ? `<#${keep247.channelId}>` : "Not set" },
                { name: "24/7 By", value: keep247.byUserId ? `<@${keep247.byUserId}>` : "N/A" },

                { name: "Autoplay Configured", value: autoplay.configured ? "Yes" : "No" },
                { name: "Autoplay Live", value: autoplay.enabled ? "On" : "Off" },
                { name: "Autoplay By", value: autoplay.byUserId ? `<@${autoplay.byUserId}>` : "N/A" },

                { name: "Voice Connected", value: player ? "Yes" : "No" },
                { name: "Now Playing", value: player?.current?.title || "Nothing" },
                { name: "Queue Size", value: String(queueSize) },
                { name: "Volume", value: player ? `${player.volume}%` : "N/A" },
                { name: "Loop", value: player ? player.loopMode : "off" },
                { name: "Filter", value: filterLabel }
            ],
            footer: "Hima Guild Configuration"
        });
    }
};
