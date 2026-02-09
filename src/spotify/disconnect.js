const { disconnectSpotifyProfile } = require("./service");

module.exports = {
    name: "spdisconnect",
    aliases: ["spotifydisconnect"],
    description: "Disconnect your Spotify profile from Hima.",
    usage: "spdisconnect",
    async execute({ message, reply }) {
        try {
            await disconnectSpotifyProfile(message.author.id);
            await reply({ title: "Spotify Disconnected", description: "Your Spotify profile has been removed." });
        } catch (error) {
            await reply({ title: "Disconnect Failed", description: String(error.message || error) });
        }
    }
};
