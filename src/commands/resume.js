module.exports = {
    name: "resume",
    aliases: [],
    description: "Resume playback.",
    usage: "resume",
    async execute({ bot, message, reply }) {
        const ok = await bot.music.resume(message.guild.id);
        if (!ok) {
            await reply({ title: "Not Paused", description: "Playback is not paused." });
            return;
        }

        await reply({ title: "Resumed", description: "Playback resumed." });
    }
};
