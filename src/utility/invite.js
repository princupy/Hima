const { PermissionsBitField } = require("discord.js");
const { buildUtilityPayload } = require("./card");

module.exports = {
    name: "invite",
    aliases: ["inv"],
    description: "Get bot invite link.",
    usage: "invite",
    async execute({ bot, message }) {
        const clientId = bot.client.user?.id;
        const perms = new PermissionsBitField([
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.UseExternalEmojis,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages
        ]).bitfield.toString();

        const inviteUrl = clientId
            ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=bot`
            : "https://discord.com/developers/applications";

        await message.reply(buildUtilityPayload({
            bot,
            title: "Invite Hima",
            summary: "Add Hima to your server with recommended permissions.",
            details: [
                `**Client ID:** ${clientId || "Unknown"}`,
                `**Permissions:** ${perms}`
            ],
            buttons: [
                {
                    label: "Invite Bot",
                    url: inviteUrl,
                    emoji: process.env.UTILITY_INVITE_EMOJI || "<:icons8chatbot48:1457046154473767117>"
                }
            ],
            footer: "Hima Invite Panel"
        }));
    }
};
