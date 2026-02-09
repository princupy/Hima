function toBool(value, fallback = false) {
    if (value == null || value === "") return fallback;
    return String(value).trim().toLowerCase() === "true";
}

function toNum(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeNode(node, idx = 0, prefix = "node") {
    if (!node) return null;
    const host = String(node.host || "").trim();
    const port = Number(node.port || 0);
    const password = String(node.password || "").trim();
    if (!host || !port || !password) return null;

    return {
        host,
        port,
        password,
        secure: Boolean(node.secure),
        identifier: String(node.identifier || `${prefix}-${idx + 1}`)
    };
}

function parseJsonNodes(value) {
    const text = String(value || "").trim();
    if (!text) return [];
    try {
        const raw = JSON.parse(text);
        if (!Array.isArray(raw)) return [];
        return raw
            .map((n, i) => normalizeNode(n, i, "premium"))
            .filter(Boolean);
    } catch {
        return [];
    }
}

function parsePremiumNodesFromEnv(env = process.env) {
    const jsonNodes = parseJsonNodes(env.PREMIUM_LAVALINK_NODES_JSON);
    if (jsonNodes.length) return jsonNodes;

    const out = [];

    const ssl = normalizeNode({
        host: env.PREMIUM_LAVALINK_SSL_HOST,
        port: toNum(env.PREMIUM_LAVALINK_SSL_PORT, 0),
        password: env.PREMIUM_LAVALINK_SSL_PASSWORD,
        secure: toBool(env.PREMIUM_LAVALINK_SSL_SECURE, true),
        identifier: env.PREMIUM_LAVALINK_SSL_IDENTIFIER || "premium-ssl"
    }, 0, "premium");

    if (ssl) out.push(ssl);

    const nonssl = normalizeNode({
        host: env.PREMIUM_LAVALINK_NONSSL_HOST,
        port: toNum(env.PREMIUM_LAVALINK_NONSSL_PORT, 0),
        password: env.PREMIUM_LAVALINK_NONSSL_PASSWORD,
        secure: toBool(env.PREMIUM_LAVALINK_NONSSL_SECURE, false),
        identifier: env.PREMIUM_LAVALINK_NONSSL_IDENTIFIER || "premium-nonssl"
    }, 1, "premium");

    if (nonssl) out.push(nonssl);

    return out;
}

module.exports = {
    parsePremiumNodesFromEnv,
    normalizeNode
};
