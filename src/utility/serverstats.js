const { buildUtilityPayload } = require("./card");

module.exports = {
    name: "serverstats",
    aliases: ["ss"],
    description: "Show current server statistics.",
    usage: "serverstats",
    async execute({ bot, message, reply }) {
        const guild = message.guild;
        if (!guild) {
            await reply({ title: "Server Only", description: "Use this command inside a server." });
            return;
        }

        const channels = guild.channels.cache;
        const textChannels = channels.filter((c) => c.isTextBased()).size;
        const voiceChannels = channels.filter((c) => c.isVoiceBased()).size;

        await message.reply(buildUtilityPayload({
            bot,
            title: "Server Stats",
            summary: `Live stats for **${guild.name}**.`,
            details: [
                `**Server ID:** ${guild.id}`,
                `**Members:** ${guild.memberCount}`,
                `**Text Channels:** ${textChannels}`,
                `**Voice Channels:** ${voiceChannels}`,
                `**Roles:** ${guild.roles.cache.size}`,
                `**Created:** <t:${Math.floor(guild.createdTimestamp / 1000)}:F>`
            ],
            footer: "Hima Server Analytics"
        }));
    }
};
