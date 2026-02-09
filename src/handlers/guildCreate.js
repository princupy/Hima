const { ensureGuild } = require("../database/guildConfig");

function registerGuildCreateHandler(bot) {
    bot.client.on("guildCreate", async (guild) => {
        await ensureGuild(guild.id).catch((err) => {
            console.error("[guildCreate ensureGuild]", err);
        });
    });
}

module.exports = { registerGuildCreateHandler };
