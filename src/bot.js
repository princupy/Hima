const {
    Client,
    GatewayIntentBits,
    Partials
} = require("discord.js");
const { loadConfig } = require("./config");
const { loadCommands } = require("./commands");
const { registerReadyHandler } = require("./handlers/ready");
const { registerGuildCreateHandler } = require("./handlers/guildCreate");
const { registerMessageCreateHandler } = require("./handlers/messageCreate");
const { registerPlaylistAutoloadHandler } = require("./playlists/autoloadHandler");
const { MusicManager } = require("./music/manager");
const { SpotifyService } = require("./music/spotify");
const { createContainer } = require("./components/containerBuilder");

function toFallbackText(payload) {
    const lines = [];
    if (payload?.title) lines.push(`**${payload.title}**`);
    if (payload?.description) lines.push(payload.description);
    if (Array.isArray(payload?.sections)) {
        for (const section of payload.sections) {
            const t = section?.title ? `${section.title}: ` : "";
            lines.push(`${t}${section?.content || ""}`.trim());
        }
    }
    if (payload?.footer) lines.push(payload.footer);
    return lines.join("\n").slice(0, 1900) || "Music update";
}

class HimaBot {
    constructor() {
        this.config = loadConfig();
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.MessageContent
            ],
            partials: [Partials.Channel]
        });

        this.commands = loadCommands();
        this.commandMap = new Map();
        this.aliasMap = new Map();

        for (const cmd of this.commands) {
            this.commandMap.set(cmd.name, cmd);
            for (const alias of cmd.aliases || []) this.aliasMap.set(alias, cmd.name);
        }

        this.spotify = new SpotifyService(this.config.spotify);

        this.music = new MusicManager({
            client: this.client,
            lavalink: this.config.lavalink,
            premiumLavalinkNodes: this.config.premiumLavalinkNodes,
            sendContainer: async (channelId, payload) => {
                const channel = await this.client.channels.fetch(channelId).catch(() => null);
                if (!channel) return;
                try {
                    await channel.send(createContainer(payload));
                } catch (error) {
                    console.error("[Music ComponentsV2 Error]", error?.message || error);
                    await channel.send({ content: toFallbackText(payload) }).catch((fallbackError) => {
                        console.error("[Music Fallback Error]", fallbackError?.message || fallbackError);
                    });
                }
            }
        });

        registerReadyHandler(this);
        registerGuildCreateHandler(this);
        registerMessageCreateHandler(this);
        registerPlaylistAutoloadHandler(this);

        this.client.on("interactionCreate", async (interaction) => {
            try {
                if (!(interaction.isButton() || interaction.isStringSelectMenu())) return;

                const handledByMusic = await this.music.handleInteraction({ interaction });
                if (handledByMusic) return;

                for (const command of this.commands) {
                    if (typeof command.handleInteraction !== "function") continue;
                    const handled = await command.handleInteraction({ bot: this, interaction });
                    if (handled) return;
                }
            } catch (error) {
                console.error("[Interaction Error]", error);
            }
        });

        this.client.on("error", (error) => {
            console.error("[Discord Client Error]", error);
        });

        process.on("unhandledRejection", (err) => {
            console.error("[Unhandled Rejection]", err);
        });

        process.on("uncaughtException", (err) => {
            console.error("[Uncaught Exception]", err);
        });
    }

    async start() {
        await this.client.login(this.config.discordToken);
    }
}

module.exports = { HimaBot };

