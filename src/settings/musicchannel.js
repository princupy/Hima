const { PermissionFlagsBits } = require("discord.js");
const { getMusicChannel, setMusicChannel } = require("../database/guildConfig");

module.exports = {
    name: "musicchannel",
    aliases: ["setmusic", "musicch", "musicsetup"],
    description: "Set or clear dedicated music command channel for this guild.",
    usage: "musicchannel <set #channel|clear|show>",

    async execute({ message, args, reply }) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await reply({
                title: "Permission Required",
                description: "You need `Manage Server` permission to configure music channel."
            });
            return;
        }

        const sub = String(args[0] || "show").toLowerCase();

        if (sub === "show") {
            const current = await getMusicChannel(message.guild.id);
            await reply({
                title: "Music Channel Config",
                description: current
                    ? `Music commands are locked to <#${current}>.`
                    : "No lock set. Music commands work in any channel.",
                footer: "Use musicchannel set #channel or musicchannel clear"
            });
            return;
        }

        if (sub === "clear" || sub === "off" || sub === "disable") {
            await setMusicChannel(message.guild.id, null);
            await reply({
                title: "Music Channel Cleared",
                description: "Music commands are now allowed in all text channels."
            });
            return;
        }

        if (sub === "set") {
            const channel = message.mentions.channels.first()
                || (args[1] ? message.guild.channels.cache.get(args[1].replace(/[^0-9]/g, "")) : null);

            if (!channel || !channel.isTextBased()) {
                await reply({
                    title: "Invalid Channel",
                    description: "Usage: `musicchannel set #channel`"
                });
                return;
            }

            await setMusicChannel(message.guild.id, channel.id);
            await reply({
                title: "Music Channel Updated",
                description: `Music commands will work only in <#${channel.id}>.`
            });
            return;
        }

        await reply({
            title: "Invalid Usage",
            description: "Use `musicchannel set #channel`, `musicchannel clear`, or `musicchannel show`."
        });
    }
};
