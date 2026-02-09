const { MessageFlags } = require("discord.js");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const PAGE_SIZE = 10;
const VIEW_TTL_MS = 15 * 60 * 1000;
const views = new Map();

function toLinkedTitle(track) {
    const title = track?.title || "Unknown Track";
    const url = track?.uri;
    return url ? `[${title}](${url})` : title;
}

function parseButtonEmoji(raw) {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();

    const custom = trimmed.match(/^<(a?):([\w~]+):(\d+)>$/);
    if (custom) {
        return {
            animated: custom[1] === "a",
            name: custom[2],
            id: custom[3]
        };
    }

    return { name: trimmed };
}

function buildQueueMessage(queue, page, token) {
    const nowPlaying = `1. ${toLinkedTitle(queue.current)}`;
    const totalPages = Math.max(1, Math.ceil(queue.upcoming.length / PAGE_SIZE));
    const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);

    const start = clampedPage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageTracks = queue.upcoming.slice(start, end);

    const upcoming = pageTracks.length
        ? pageTracks
            .map((track, index) => `${start + index + 2}. ${toLinkedTitle(track)}`)
            .join("\n")
        : "No upcoming songs.";

    const prevEmoji = parseButtonEmoji(process.env.QUEUE_PREV_EMOJI || "<:icons8back48:1458791199006789805>");
    const nextEmoji = parseButtonEmoji(process.env.QUEUE_NEXT_EMOJI || "<:icons8arrow48:1458191390264660049>");

    const children = [
        { type: 10, content: "## Music Queue" },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: "**Now Playing**\n" + nowPlaying },
        {
            type: 10,
            content: `**Upcoming Songs**\n${upcoming}\n\nPage **${clampedPage + 1}/${totalPages}**`
        },
        { type: 14, divider: true, spacing: 1 },
        {
            type: 9,
            components: [{ type: 10, content: "Queue Controls" }],
            accessory: {
                type: 2,
                style: 2,
                label: "Previous",
                custom_id: `queue:${token}:prev`,
                disabled: clampedPage === 0,
                ...(prevEmoji ? { emoji: prevEmoji } : {})
            }
        },
        {
            type: 9,
            components: [{ type: 10, content: "Page Navigation" }],
            accessory: {
                type: 2,
                style: 2,
                label: "Next",
                custom_id: `queue:${token}:next`,
                disabled: clampedPage >= totalPages - 1,
                ...(nextEmoji ? { emoji: nextEmoji } : {})
            }
        },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `**Total Queued**\n${queue.total}` }
    ];

    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: children
            }
        ]
    };
}

function cleanupViews() {
    const now = Date.now();
    for (const [token, view] of views) {
        if (view.expiresAt <= now) views.delete(token);
    }
}

module.exports = {
    name: "queue",
    aliases: ["q"],
    description: "Show queued tracks.",
    usage: "queue",
    async execute({ bot, message, reply }) {
        cleanupViews();

        const queue = bot.music.getQueue(message.guild.id);
        if (!queue || !queue.current) {
            await reply({ title: "Queue Empty", description: "No tracks are playing." });
            return;
        }

        const token = Math.random().toString(36).slice(2, 10);
        views.set(token, {
            guildId: message.guild.id,
            userId: message.author.id,
            page: 0,
            expiresAt: Date.now() + VIEW_TTL_MS
        });

        await message.reply(buildQueueMessage(queue, 0, token));
    },

    async handleInteraction({ bot, interaction }) {
        if (!interaction.isButton()) return false;
        if (!interaction.customId.startsWith("queue:")) return false;

        cleanupViews();

        const [, token, direction] = interaction.customId.split(":");
        const view = views.get(token);

        if (!view || view.expiresAt <= Date.now()) {
            views.delete(token);
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Your Music Queue" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "This queue panel expired. Run the queue command again." }
                        ]
                    }
                ]
            });
            return true;
        }

        if (interaction.user.id !== view.userId) {
            await interaction.deferUpdate().catch(() => null);
            return true;
        }

        const queue = bot.music.getQueue(view.guildId);
        if (!queue || !queue.current) {
            await interaction.update({
                flags: COMPONENTS_V2_FLAG,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Music Queue" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: "Queue is empty now." }
                        ]
                    }
                ]
            });
            return true;
        }

        const totalPages = Math.max(1, Math.ceil(queue.upcoming.length / PAGE_SIZE));
        let page = view.page;
        if (direction === "next") page += 1;
        if (direction === "prev") page -= 1;
        page = Math.min(Math.max(page, 0), totalPages - 1);

        view.page = page;
        view.expiresAt = Date.now() + VIEW_TTL_MS;
        views.set(token, view);

        await interaction.update(buildQueueMessage(queue, page, token));
        return true;
    }
};
