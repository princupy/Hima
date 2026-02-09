const { buildUtilityPayload } = require("./card");

module.exports = {
    name: "voiceinfo",
    aliases: ["vcinfo"],
    description: "Show voice connection and channel details.",
    usage: "voiceinfo",
    async execute({ bot, message, reply }) {
        const memberVoice = message.member?.voice?.channel;
        const state = bot.music.get(message.guild.id);
        const botVoice = state?.voiceChannelId
            ? await message.guild.channels.fetch(state.voiceChannelId).catch(() => null)
            : null;

        if (!memberVoice && !botVoice) {
            await reply({ title: "Voice Info", description: "No active voice channel found." });
            return;
        }

        await message.reply(buildUtilityPayload({
            bot,
            title: "Voice Info",
            summary: "Current voice session details.",
            details: [
                `**Your Channel:** ${memberVoice ? `${memberVoice.name} (${memberVoice.id})` : "Not connected"}`,
                `**Bot Channel:** ${botVoice ? `${botVoice.name} (${botVoice.id})` : "Not connected"}`,
                `**Queue Length:** ${state ? state.queue.length : 0}`,
                `**Now Playing:** ${state?.current?.title || "Nothing"}`,
                `**Paused:** ${state?.isPaused ? "Yes" : "No"}`
            ],
            footer: "Hima Voice Diagnostics"
        }));
    }
};
