const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

function parseEmoji(raw) {
    const value = String(raw || "").trim();
    if (!value) return undefined;

    const custom = value.match(/^<(a?):([\w~]+):(\d+)>$/);
    if (custom) {
        return {
            animated: custom[1] === "a",
            name: custom[2],
            id: custom[3]
        };
    }

    return { name: value };
}

function buildUtilityPayload({ bot, title, summary, details = [], footer, buttons = [] }) {
    const avatar = bot.client.user?.displayAvatarURL?.({ extension: "png", size: 1024 }) || null;

    const children = [
        { type: 10, content: `## ${title}` },
        { type: 14, divider: true, spacing: 1 },
        {
            type: 9,
            components: [{ type: 10, content: summary || "-" }],
            ...(avatar ? { accessory: { type: 11, media: { url: avatar } } } : {})
        },
        { type: 14, divider: true, spacing: 1 }
    ];

    for (const line of details) {
        children.push({ type: 10, content: line });
    }

    if (buttons.length) {
        children.push({ type: 14, divider: true, spacing: 1 });
        children.push({
            type: 1,
            components: buttons.map((b) => ({
                type: 2,
                style: b.style || 5,
                label: b.label,
                ...(b.url ? { url: b.url } : {}),
                ...(b.custom_id ? { custom_id: b.custom_id } : {}),
                ...(b.emoji ? { emoji: parseEmoji(b.emoji) } : {})
            }))
        });
    }

    if (footer) {
        children.push({ type: 14, divider: true, spacing: 1 });
        children.push({ type: 10, content: `-# ${footer}` });
    }

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [{ type: 17, components: children }]
    };
}

module.exports = {
    COMPONENTS_V2_FLAG,
    parseEmoji,
    buildUtilityPayload
};
