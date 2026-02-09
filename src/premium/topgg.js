async function hasVotedOnTopGG(botId, userId, token) {
    if (!token) throw new Error("TOPGG_TOKEN is missing.");
    if (!botId) throw new Error("Bot ID is missing.");

    const url = `https://top.gg/api/bots/${botId}/check?userId=${userId}`;
    const res = await fetch(url, {
        headers: {
            Authorization: token,
            "Content-Type": "application/json"
        }
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Top.gg request failed (${res.status}): ${body || "Unknown error"}`);
    }

    const data = await res.json().catch(() => ({}));
    return String(data?.voted || "0") === "1";
}

module.exports = { hasVotedOnTopGG };
