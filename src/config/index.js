const { parsePremiumNodesFromEnv } = require("../lavalink/nodes");

function required(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
}

function loadConfig() {
    return {
        discordToken: required("DISCORD_TOKEN"),
        supabase: {
            url: required("SUPABASE_URL"),
            key: required("SUPABASE_KEY"),
            prefixCacheTtlMs: 5 * 60 * 1000
        },
        lavalink: {
            host: required("LAVALINK_HOST"),
            port: Number(required("LAVALINK_PORT")),
            password: required("LAVALINK_PASSWORD"),
            secure: process.env.LAVALINK_SECURE === "true",
            identifier: process.env.LAVALINK_IDENTIFIER || "public-node"
        },
        premiumLavalinkNodes: parsePremiumNodesFromEnv(process.env),
        spotify: {
            clientId: required("SPOTIFY_CLIENT_ID"),
            clientSecret: required("SPOTIFY_CLIENT_SECRET")
        },
        noPrefix: {
            ownerId: required("BOT_OWNER_ID"),
            logChannelId: required("NO_PREFIX_LOG_CHANNEL_ID")
        },
        premium: {
            topggToken: process.env.TOPGG_TOKEN || "",
            voteHours: Number(process.env.VOTE_PREMIUM_HOURS || 12),
            voteLogChannelId: process.env.PREMIUM_VOTE_LOG_CHANNEL_ID || "",
            buyUrl: process.env.PREMIUM_BUY_URL || ""
        },
        defaults: {
            prefix: "H!"
        }
    };
}

module.exports = { loadConfig };
