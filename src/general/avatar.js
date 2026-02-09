const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

async function resolveTarget(message, raw) {
    const mention = message.mentions.users.first();
    if (mention) return mention;

    const id = String(raw || "").replace(/[^0-9]/g, "");
    if (id) {
        const fetched = await message.client.users.fetch(id).catch(() => null);
        if (fetched) return fetched;
    }

    return message.author;
}

module.exports = {
    name: "avatar",
    aliases: ["av", "pfp"],
    description: "Show user avatar in high quality (user + server avatar).",
    usage: "avatar [@user|id]",

    async execute({ message, args, reply }) {
        const target = await resolveTarget(message, args[0]);
        const member = await message.guild.members.fetch(target.id).catch(() => null);

        const userAvatar = target.displayAvatarURL({ extension: "png", size: 4096 });
        const guildAvatar = member?.avatarURL?.({ extension: "png", size: 4096 }) || null;

        const fields = [
            { name: "User", value: `<@${target.id}>` },
            { name: "Avatar Link", value: `[Open Avatar](${userAvatar})` }
        ];

        if (guildAvatar) {
            fields.push({ name: "Server Avatar", value: `[Open Server Avatar](${guildAvatar})` });
        }

        const mediaItems = [{ media: { url: userAvatar } }];
        if (guildAvatar) mediaItems.push({ media: { url: guildAvatar } });

        await message.reply({
            flags: COMPONENTS_V2_FLAG,
            components: [
                {
                    type: 17,
                    components: [
                        { type: 10, content: "## Avatar Viewer" },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: `**${target.username}**\nID: ${target.id}` },
                        ...fields.map((f) => ({ type: 10, content: `**${f.name}**\n${f.value}` })),
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: guildAvatar ? "**High Quality Avatar Preview (User + Server)**" : "**High Quality Avatar Preview**" },
                        { type: 12, items: mediaItems },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: "-# Use avatar @user or avatar userId" }
                    ]
                }
            ]
        }).catch(async () => {
            await reply({
                title: "Avatar Viewer",
                description: `User: <@${target.id}>`,
                fields,
                image: userAvatar,
                footer: guildAvatar ? "Server avatar available" : "No server avatar"
            });
        });
    }
};
