const { MessageFlags } = require("discord.js");
const { formatDuration } = require("../utils/format");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const PROGRESS_BAR_SIZE = 16;

function escapeText(input) {
    const value = String(input || "Unknown");
    return value
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
        .replace(/\*/g, "\\*")
        .replace(/`/g, "\\`");
}

function toLinkedTitle(track) {
    const title = escapeText(track?.title || "Unknown Track");
    const uri = track?.uri;
    return uri ? `[${title}](${uri})` : title;
}

function buildProgressBar(positionMs, lengthMs) {
    const safeLength = Number.isFinite(lengthMs) && lengthMs > 0 ? lengthMs : 0;
    const safePos = Number.isFinite(positionMs) && positionMs > 0 ? positionMs : 0;

    if (!safeLength) {
        return "[----------------]";
    }

    const ratio = Math.max(0, Math.min(1, safePos / safeLength));
    const pointer = Math.min(PROGRESS_BAR_SIZE - 1, Math.floor(ratio * (PROGRESS_BAR_SIZE - 1)));

    let bar = "[";
    for (let i = 0; i < PROGRESS_BAR_SIZE; i += 1) {
        if (i === pointer) bar += "o";
        else if (i < pointer) bar += "=";
        else bar += "-";
    }
    bar += "]";
    return bar;
}

function buildLoopLabel(loopMode) {
    if (loopMode === "track") return "Track";
    if (loopMode === "queue") return "Queue";
    return "Off";
}

/**
 * Build Glass Wave now playing card for Components V2.
 * @param {{
 *  track: any,
 *  positionMs: number,
 *  queueSize: number,
 *  volume: number,
 *  loopMode: string,
 *  requester?: string,
 *  isPaused?: boolean
 * }} input
 */
function buildGlassWaveNowPlayingCard(input) {
    const {
        track,
        positionMs,
        queueSize,
        volume,
        loopMode,
        requester,
        isPaused
    } = input;

    const trackTitle = toLinkedTitle(track);
    const artist = escapeText(track?.author || "Unknown");
    const duration = formatDuration(track?.length || 0);
    const elapsed = formatDuration(positionMs || 0);
    const progressBar = buildProgressBar(positionMs || 0, track?.length || 0);
    const status = isPaused ? "Paused" : "Live";

    const children = [
        { type: 10, content: "## Now Playing" },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: `### ${trackTitle}` },
        {
            type: 10,
            content: `**Artist**\n${artist}\n\n**Status**\n${status}`
        },
        {
            type: 10,
            content: `**Progress**\n${progressBar}\n${elapsed} / ${duration}`
        },
        {
            type: 10,
            content: `**Queue**\n${queueSize}\n\n**Volume**\n${volume}%\n\n**Loop**\n${buildLoopLabel(loopMode)}`
        }
    ];

    if (track?.artworkUrl) {
        children.push({
            type: 12,
            items: [{ media: { url: track.artworkUrl } }]
        });
    }

    children.push({ type: 14, divider: true, spacing: 1 });
    children.push({
        type: 10,
        content: `-# Requested by ${escapeText(requester || track?.requester || "unknown")}`
    });

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

module.exports = {
    buildGlassWaveNowPlayingCard
};
