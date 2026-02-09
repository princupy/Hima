const { MessageFlags } = require("discord.js");
const { createContainer } = require("../components/containerBuilder");
const {
    getExpiredActiveNoPrefixUsers,
    markExpiredNoPrefixUser
} = require("../database/noPrefix");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

let expiryTimer = null;

function formatExpiry(expiresAt) {
    if (!expiresAt) return "Permanent";
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) return "Unknown";
    return `<t:${Math.floor(d.getTime() / 1000)}:F>`;
}

function parseEmoji(raw, fallback) {
    const source = (raw || fallback || "").trim();
    if (!source) return undefined;

    const custom = source.match(/^<(a?):([\w~]+):(\d+)>$/);
    if (custom) {
        return {
            animated: custom[1] === "a",
            name: custom[2],
            id: custom[3]
        };
    }

    return { name: source };
}

function buildExpiryContactPayload(bot, mentionText) {
    const ownerId = bot.config?.noPrefix?.ownerId;
    const discordInvite = process.env.NO_PREFIX_CONTACT_DISCORD_URL || "https://discord.gg/37WBxRXVq5";
    const instagramUrl = process.env.NO_PREFIX_CONTACT_INSTAGRAM_URL || "https://www.instagram.com/tanmoy_here8388/";
    const ownerDmUrl = ownerId ? `https://discord.com/users/${ownerId}` : discordInvite;

    const discordEmoji = parseEmoji(process.env.NO_PREFIX_CONTACT_DISCORD_EMOJI, "<:icons8discord48:1469589509724180480>");
    const instagramEmoji = parseEmoji(process.env.NO_PREFIX_CONTACT_INSTAGRAM_EMOJI, "<:icons8instagram48:1469589483958571202>");
    const dmEmoji = parseEmoji(process.env.NO_PREFIX_CONTACT_DM_EMOJI, "<:icons8chat48:1469589537171832886>");

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## No Prefix Expired" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: mentionText || "Your no-prefix access has expired." },
                    { type: 10, content: "**Status**\nAccess is now disabled." },
                    { type: 10, content: "**Next**\nContact the bot owner to renew access." },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 9,
                        components: [{ type: 10, content: "Join Discord Server" }],
                        accessory: {
                            type: 2,
                            style: 5,
                            label: "Discord",
                            url: discordInvite,
                            ...(discordEmoji ? { emoji: discordEmoji } : {})
                        }
                    },
                    {
                        type: 9,
                        components: [{ type: 10, content: "Contact on Instagram" }],
                        accessory: {
                            type: 2,
                            style: 5,
                            label: "Instagram",
                            url: instagramUrl,
                            ...(instagramEmoji ? { emoji: instagramEmoji } : {})
                        }
                    },
                    {
                        type: 9,
                        components: [{ type: 10, content: "Direct DM to Owner" }],
                        accessory: {
                            type: 2,
                            style: 5,
                            label: "Direct DM",
                            url: ownerDmUrl,
                            ...(dmEmoji ? { emoji: dmEmoji } : {})
                        }
                    }
                ]
            }
        ]
    };
}

async function sendContainerToChannel(bot, channelId, payload) {
    if (!channelId) return;
    const channel = await bot.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    await channel.send(payload).catch(() => null);
}

async function sendNoPrefixLog(bot, payload) {
    const logChannelId = bot.config?.noPrefix?.logChannelId;
    if (!logChannelId) return;
    await sendContainerToChannel(bot, logChannelId, {
        ...createContainer(payload),
        allowedMentions: { parse: [] }
    });
}

async function notifyExpiredUser(bot, row) {
    const user = await bot.client.users.fetch(row.user_id).catch(() => null);

    const dmPayload = buildExpiryContactPayload(bot);

    if (user) {
        const dmOk = await user.send(dmPayload).then(() => true).catch(() => false);
        if (dmOk) return;
    }

    const fallbackChannelId = row.added_channel_id;
    if (!fallbackChannelId) return;

    await sendContainerToChannel(
        bot,
        fallbackChannelId,
        buildExpiryContactPayload(
            bot,
            `<@${row.user_id}> your no-prefix access expired.`
        )
    );
}

async function processNoPrefixExpirations(bot) {
    const expired = await getExpiredActiveNoPrefixUsers().catch((err) => {
        console.error("[NoPrefix Expiry Fetch Error]", err);
        return [];
    });

    for (const row of expired) {
        const updated = await markExpiredNoPrefixUser(row.user_id).catch((err) => {
            console.error(`[NoPrefix Expiry Mark Error:${row.user_id}]`, err);
            return null;
        });

        if (!updated) continue;

        await sendNoPrefixLog(bot, {
            title: "No Prefix Expired",
            description: `No-prefix expired for <@${updated.user_id}>.`,
            sections: [
                { title: "User ID", content: updated.user_id },
                { title: "Was Expiry", content: formatExpiry(row.expires_at) }
            ]
        });

        await notifyExpiredUser(bot, row);
    }
}

function startNoPrefixExpiryLoop(bot) {
    if (expiryTimer) {
        clearInterval(expiryTimer);
        expiryTimer = null;
    }

    processNoPrefixExpirations(bot).catch(() => null);

    expiryTimer = setInterval(() => {
        processNoPrefixExpirations(bot).catch(() => null);
    }, 60 * 1000);

    if (typeof expiryTimer.unref === "function") expiryTimer.unref();
}

module.exports = {
    sendNoPrefixLog,
    processNoPrefixExpirations,
    startNoPrefixExpiryLoop,
    formatExpiry
};

