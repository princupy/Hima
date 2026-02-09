const { listUserPlaylists, hasSpotifyFeatureAccess } = require("./service");

function short(text, max = 120) {
    const v = String(text || "").trim();
    if (v.length <= max) return v;
    return `${v.slice(0, max - 3)}...`;
}

function buildLines(items, maxLen = 1700) {
    const out = [];
    let total = 0;

    for (const p of items) {
        const line = `${p.index}. [${short(p.name, 90)}](${p.url}) - ${p.tracks} tracks`;
        if (total + line.length + 1 > maxLen) break;
        out.push(line);
        total += line.length + 1;
    }

    return out.length ? out.join("\n") : "No public playlists found.";
}

module.exports = {
    name: "spplaylists",
    aliases: ["splist", "myplaylists"],
    description: "Show playlists from your connected Spotify profile.",
    usage: "spplaylists [page]",
    async execute({ bot, message, args, reply }) {
        const access = await hasSpotifyFeatureAccess(message.author.id);
        if (!access) {
            await reply({ title: "Premium Required", description: "Spotify playlists need vote premium or buy premium." });
            return;
        }

        const page = Number(args[0] || 1);

        try {
            const data = await listUserPlaylists(bot, message.author.id, { page, pageSize: 10 });
            const lines = buildLines(data.items);

            await reply({
                title: "Spotify Playlists",
                description: `Profile: [${short(data.profile.display_name, 60)}](${data.profile.profile_url})`,
                fields: [
                    { name: `Page ${data.page}`, value: lines },
                    { name: "Total", value: String(data.total) }
                ],
                footer: "Use spplay <number> after this list"
            });
        } catch (error) {
            await reply({ title: "Playlist Fetch Failed", description: String(error.message || error) });
        }
    }
};
