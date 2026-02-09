const guildCooldowns = new Map();
const DISCONNECT_COOLDOWN_MS = 1200;

module.exports = {
    name: "disconnect",
    aliases: ["dc", "leave"],
    description: "Disconnect bot from voice channel.",
    usage: "disconnect",
    async execute({ bot, message, reply }) {
        const now = Date.now();
        const key = message.guild.id;
        const last = guildCooldowns.get(key) || 0;
        if (now - last < DISCONNECT_COOLDOWN_MS) {
            return;
        }
        guildCooldowns.set(key, now);

        const ok = await bot.music.disconnect(message.guild.id);
        if (!ok) {
            await reply({ title: "Not Connected", description: "No active voice connection." });
            return;
        }

        await reply({ title: "Disconnected", description: "Left voice channel." });
    }
};
