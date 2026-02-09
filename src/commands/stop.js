module.exports = {
    name: "stop",
    aliases: [],
    description: "Stop playback and clear queue.",
    usage: "stop",
    async execute({ bot, message, reply }) {
        const ok = await bot.music.stop(message.guild.id);
        if (!ok) {
            await reply({ title: "Idle", description: "No active player." });
            return;
        }

        await reply({ title: "Stopped", description: "Queue cleared and playback stopped." });
    }
};
