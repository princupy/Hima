const { hasSpotifyFeatureAccess, getCachedPlaylistByNumber } = require("./service");

function parsePlaylistUrl(input) {
    const value = String(input || "").trim();
    const m = value.match(/^https?:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+/i);
    return m ? m[0] : null;
}

module.exports = {
    name: "spplay",
    aliases: ["spotifyplay"],
    description: "Play playlist from your spotify list number or playlist URL.",
    usage: "spplay <number|spotify_playlist_url>",
    async execute(ctx) {
        const { bot, message, args, reply } = ctx;
        const access = await hasSpotifyFeatureAccess(message.author.id);
        if (!access) {
            await reply({ title: "Premium Required", description: "Spotify play needs vote premium or buy premium." });
            return;
        }

        const input = args[0];
        if (!input) {
            await reply({ title: "Missing Input", description: "Usage: spplay <number|spotify_playlist_url>" });
            return;
        }

        let url = parsePlaylistUrl(input);
        if (!url) {
            const fromCache = getCachedPlaylistByNumber(message.author.id, input);
            if (!fromCache) {
                await reply({
                    title: "Playlist Not Found",
                    description: "Use `spplaylists` first, then use a valid number from the list."
                });
                return;
            }
            url = fromCache.url;
        }

        const play = bot.commandMap.get("play");
        if (!play) {
            await reply({ title: "Play Command Missing", description: "Core play command is not loaded." });
            return;
        }

        await play.execute({
            bot,
            message,
            args: [url],
            prefix: ctx.prefix,
            reply
        });
    }
};
