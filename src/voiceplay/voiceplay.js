const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("../premium/profile");
const { voteUrl, buyUrl } = require("../premium/service");
const { getVoicePlayEnabled, setVoicePlayEnabled } = require("./store");

async function ensureListeningConnection({ bot, message, reply }) {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    const voice = member?.voice?.channel;
    if (!voice) {
        await reply({
            title: "Join Voice Channel",
            description: "`voiceplay on` use karne se pehle voice channel join karo."
        });
        return false;
    }

    const me = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
    const perms = voice.permissionsFor(me);
    if (!perms?.has("Connect") || !perms?.has("Speak")) {
        await reply({
            title: "Missing Permissions",
            description: "Mujhe voice channel me `Connect` aur `Speak` permission chahiye."
        });
        return false;
    }

    const state = bot.music.get(message.guildId);
    const shardId = message.guild.shardId || 0;
    const currentSelfDeaf = Boolean(message.guild.members.me?.voice?.selfDeaf);

    try {
        if (!state) {
            await bot.music.create(message.guildId, voice.id, message.channelId, shardId, message.author.id, { deaf: false });
        } else if (state.voiceChannelId !== voice.id || currentSelfDeaf) {
            await bot.music.disconnect(message.guildId).catch(() => null);
            await bot.music.create(message.guildId, voice.id, message.channelId, shardId, message.author.id, { deaf: false });
        } else {
            state.textChannelId = message.channelId;
        }

        return true;
    } catch (error) {
        await reply({
            title: "Voice Listener Failed",
            description: "Voice listener start nahi ho paaya.",
            fields: [{ name: "Reason", value: String(error?.message || error) }]
        });
        return false;
    }
}

module.exports = {
    name: "voiceplay",
    aliases: ["vplay", "voicecmd"],
    description: "Premium voice trigger: say 'play <song>' in VC to auto-run play.",
    usage: "voiceplay <on|off|status>",
    async execute({ bot, message, args, reply }) {
        if (!message.guildId || !message.guild) {
            await reply({ title: "Guild Only", description: "Use this command inside a server." });
            return;
        }

        const sub = String(args[0] || "status").toLowerCase();

        const voteActive = await isVotePremiumActive(message.author.id).catch(() => false);
        const buyActive = await hasUserPaidPremiumAccess(message.author.id).catch(() => false);
        const premiumActive = voteActive || buyActive;

        if (!premiumActive) {
            await message.reply({
                flags: 1 << 15,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Premium Required" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "Voice Play feature is available for Vote Premium or Buy Premium users only." },
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
            }).catch(() => null);
            return;
        }

        if (sub === "status") {
            const enabled = await getVoicePlayEnabled(message.guildId, message.author.id);
            const state = bot.music.get(message.guildId);
            const selfDeaf = Boolean(message.guild.members.me?.voice?.selfDeaf);
            await reply({
                title: "Voice Play Status",
                description: "Premium voice trigger configuration.",
                fields: [
                    { name: "State", value: enabled ? "ON" : "OFF" },
                    { name: "Listener", value: state?.voiceChannelId ? `Connected (<#${state.voiceChannelId}>)` : "Not connected" },
                    { name: "Self Deaf", value: selfDeaf ? "ON (speech won't work)" : "OFF" },
                    { name: "Rule", value: "Only `play <song name>` works via voice." },
                    { name: "Voice Required", value: "Join voice channel and say `play <song>`" }
                ],
                footer: "Use: voiceplay on / voiceplay off"
            });
            return;
        }

        if (sub === "on") {
            const ok = await ensureListeningConnection({ bot, message, reply });
            if (!ok) return;

            await setVoicePlayEnabled(message.guildId, message.author.id, true);
            const selfDeaf = Boolean(message.guild.members.me?.voice?.selfDeaf);
            await reply({
                title: "Voice Play Enabled",
                description: "Voice command mode is now ON for you in this server.",
                fields: [
                    { name: "How To Use", value: "Say exactly: `play <song name>`" },
                    { name: "Example", value: "`play heeriye`" },
                    { name: "Ignored", value: "Only song name without `play` will be ignored." },
                    { name: "Self Deaf", value: selfDeaf ? "ON (re-run `voiceplay on`)" : "OFF" }
                ],
                footer: "Bot joins with deaf=false for voice listening"
            });
            return;
        }

        if (sub === "off") {
            await setVoicePlayEnabled(message.guildId, message.author.id, false);
            await reply({
                title: "Voice Play Disabled",
                description: "Voice command mode is now OFF for you in this server."
            });
            return;
        }

        await reply({
            title: "Invalid Option",
            description: "Usage: voiceplay <on|off|status>"
        });
    }
};
