module.exports = {
    name: "loop",
    aliases: ["repeat"],
    description: "Cycle loop mode: off -> track -> queue.",
    usage: "loop",
    async execute({ bot, message, reply }) {
        const mode = bot.music.cycleLoop(message.guild.id);
        if (!mode) {
            await reply({ title: "Idle", description: "No active player." });
            return;
        }

        await reply({
            title: "Loop Mode",
            description: `Loop mode is now **${mode}**.`
        });
    }
};
