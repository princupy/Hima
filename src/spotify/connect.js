const { connectSpotifyProfile, hasSpotifyFeatureAccess } = require("./service");
const { voteUrl, buyUrl } = require("../premium/service");

module.exports = {
    name: "spconnect",
    aliases: ["spotifyconnect"],
    description: "Connect your Spotify profile URL to Hima.",
    usage: "spconnect <spotify_profile_url>",
    async execute({ bot, message, args, reply }) {
        const access = await hasSpotifyFeatureAccess(message.author.id);
        if (!access) {
            await message.reply({
                flags: 1 << 15,
                components: [{ type: 17, components: [
                    { type: 10, content: "## Premium Required" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Spotify profile features require vote premium or buy premium." },
                    { type: 1, components: [
                        { type: 2, style: 5, label: "Vote Premium", url: voteUrl(bot) },
                        { type: 2, style: 5, label: "Buy Premium", url: buyUrl() }
                    ]}
                ]}]
            });
            return;
        }

        const url = args[0];
        if (!url) {
            await reply({ title: "Missing URL", description: "Usage: spconnect <spotify_profile_url>" });
            return;
        }

        try {
            const row = await connectSpotifyProfile(bot, message.author.id, url);
            await reply({
                title: "Spotify Connected",
                fields: [
                    { name: "Profile", value: `[${row.display_name}](${row.profile_url})` },
                    { name: "Spotify User ID", value: row.spotify_user_id }
                ],
                footer: "Use spplaylists to view your playlists"
            });
        } catch (error) {
            await reply({ title: "Connection Failed", description: String(error.message || error) });
        }
    }
};
