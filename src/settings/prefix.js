const { PermissionsBitField } = require("discord.js");
const { setPrefix } = require("../database/guildConfig");

module.exports = {
    name: "prefix",
    aliases: [],
    description: "Set server prefix (Manage Guild required).",
    usage: "prefix <newPrefix>",
    async execute({ message, args, reply }) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            await reply({
                title: "Missing Permissions",
                description: "You need **Manage Guild** to change prefix."
            });
            return;
        }

        const newPrefix = args[0];
        if (!newPrefix || newPrefix.length > 5) {
            await reply({
                title: "Invalid Prefix",
                description: "Prefix must be 1-5 characters."
            });
            return;
        }

        await setPrefix(message.guild.id, newPrefix);
        await reply({
            title: "Prefix Updated",
            description: `New prefix: **${newPrefix}**`
        });
    }
};
