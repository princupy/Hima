const { MessageFlags } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");
const { buildGlassWaveNowPlayingCard, renderThemedCard } = require("../musiccard");
const { getFilterPreset } = require("../filter");
const {
    getActiveGuildCardTheme,
    getGuild247Settings,
    disableGuild247,
    getGuildAutoplaySettings,
    setGuildAutoplaySettings,
    disableGuildAutoplay,
    hasUserPaidPremiumAccess,
    isVotePremiumActive
} = require("../premium/profile");
const { listPlaylists, addTrack } = require("../playlists/store");
const { addFavorite } = require("../favorites/store");
const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const NOW_PLAYING_UPDATE_INTERVAL_MS = Number(process.env.NOW_PLAYING_CARD_INTERVAL_MS || 8000);
const VOICE_JOIN_RETRIES = Number(process.env.VOICE_JOIN_RETRIES || 3);
const IDLE_DISCONNECT_MS = 10_000;
const VOICE_STATUS_ENABLED = String(process.env.VOICE_CHANNEL_STATUS_ENABLED || "true").toLowerCase() !== "false";
const LAVALINK_RECONNECT_TRIES = Math.max(30, Number(process.env.LAVALINK_RECONNECT_TRIES || 999999));
const LAVALINK_RECONNECT_INTERVAL = Math.max(1000, Number(process.env.LAVALINK_RECONNECT_INTERVAL_MS || 5000));

class MusicManager {
    constructor({ client, lavalink, premiumLavalinkNodes = [], sendContainer }) {
        this.client = client;
        this.sendContainer = sendContainer;
        this.states = new Map();
        this.nowPlayingCards = new Map();
        this.warnAt = new Map();
        this.playlistPicker = new Map();
        this.voiceStatusCache = new Map();

        this.connector = new Connectors.DiscordJS(client);
        this.shoukaku = this.createShoukakuCluster("default", [
            {
                identifier: lavalink.identifier || "public-node",
                host: lavalink.host,
                port: lavalink.port,
                password: lavalink.password,
                secure: Boolean(lavalink.secure)
            }
        ]);

        this.premiumShoukaku = Array.isArray(premiumLavalinkNodes) && premiumLavalinkNodes.length
            ? this.createShoukakuCluster("premium", premiumLavalinkNodes)
            : null;
    }

    createShoukakuCluster(label, nodes) {
        const mapped = nodes.map((n, i) => ({
            name: n.identifier || `${label}-${i + 1}`,
            url: `${n.host}:${n.port}`,
            auth: n.password,
            secure: Boolean(n.secure)
        }));

        const cluster = new Shoukaku(this.connector, mapped, {
            reconnectTries: LAVALINK_RECONNECT_TRIES,
            reconnectInterval: LAVALINK_RECONNECT_INTERVAL,
            moveOnDisconnect: false,
            resume: false,
            voiceConnectionTimeout: 30000
        });

        this.registerNodeEvents(cluster, label);
        return cluster;
    }

    registerNodeEvents(cluster, label) {
        cluster.on("ready", (name, resumed) => {
            console.log(`[Lavalink:${label}] Connected: ${name} (resumed=${resumed})`);
        });

        cluster.on("error", (name, error) => {
            console.error(`[Lavalink:${label}] Node error (${name})`, error);
        });

        cluster.on("close", (name, code, reason) => {
            console.warn(`[Lavalink:${label}] Node disconnected (${name})`, { code, reason });
        });

        cluster.on("reconnecting", (name, reconnectsLeft) => {
            console.warn(`[Lavalink:${label}] Node reconnecting (${name}) - retries left: ${reconnectsLeft}`);
        });
    }
    init(botUserId) {
        this.botUserId = botUserId;
    }

    countHumanMembers(channel) {
        if (!channel?.members) return 0;
        let count = 0;
        for (const member of channel.members.values()) {
            if (!member.user?.bot) count += 1;
        }
        return count;
    }

    getVoiceChannelForState(state) {
        const guild = this.client.guilds.cache.get(state.guildId);
        if (!guild) return null;
        return guild.channels.cache.get(state.voiceChannelId) || null;
    }    async evaluateAutoPauseResume(guildId) {
        const state = this.states.get(guildId);
        if (!state?.player || !state.voiceChannelId) return;

        const voiceChannel = this.getVoiceChannelForState(state);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

        const humans = this.countHumanMembers(voiceChannel);

        if (humans === 0) {
            if (state.current && !state.isPaused) {
                await state.player.setPaused(true).catch(() => null);
                state.isPaused = true;
                state.autoPausedByEmpty = true;

                await this.sendContainer(state.textChannelId, {
                    title: "Auto Paused",
                    description: "No users in voice channel. Playback paused automatically.",
                    footer: "Join the channel to auto-resume"
                }).catch(() => null);

                await this.refreshNowPlayingCard(guildId).catch(() => null);
            }
            return;
        }

        if (state.current && state.isPaused && state.autoPausedByEmpty) {
            await state.player.setPaused(false).catch(() => null);
            state.isPaused = false;
            state.autoPausedByEmpty = false;

            await this.sendContainer(state.textChannelId, {
                title: "Auto Resumed",
                description: "A user joined voice channel. Resuming playback from where it paused."
            }).catch(() => null);

            await this.refreshNowPlayingCard(guildId).catch(() => null);
        }
    }

    updateVoiceState(oldState, newState) {
        const guildId = newState?.guild?.id || oldState?.guild?.id;
        if (!guildId) return;

        const state = this.states.get(guildId);
        if (!state) return;

        const oldChannelId = oldState?.channelId || null;
        const newChannelId = newState?.channelId || null;
        const changedUserId = newState?.id || oldState?.id;

        if (this.botUserId && changedUserId === this.botUserId) {
            state.voiceChannelId = newChannelId || null;
        }

        if (oldChannelId !== state.voiceChannelId && newChannelId !== state.voiceChannelId) return;

        setTimeout(() => {
            this.evaluateAutoPauseResume(guildId).catch(() => null);
        }, 350);
    }
    warnOnce(key, message, ttlMs = 20000) {
        const now = Date.now();
        const at = this.warnAt.get(key) || 0;
        if (now - at < ttlMs) return;
        this.warnAt.set(key, now);
        console.warn(message);
    }

    isNodeUsable(node) {
        if (!node) return false;
        if (node.connected === true) return true;
        if (String(node.state || "").toUpperCase() === "CONNECTED") return true;
        if (Number(node.state) === 2) return true;
        if (node.ws && node.ws.readyState === 1) return true;
        return false;
    }

    hasUsableNode(cluster) {
        if (!cluster) return false;
        try {
            const ideal = cluster.getIdealNode?.();
            if (this.isNodeUsable(ideal)) return true;
        } catch {}

        try {
            for (const node of cluster.nodes.values()) {
                if (this.isNodeUsable(node)) return true;
            }
        } catch {}

        return false;
    }


    getClusterNodeStats(cluster) {
        let total = 0;
        let online = 0;
        if (!cluster) return { total, online, offline: 0 };

        try {
            for (const node of cluster.nodes.values()) {
                total += 1;
                if (this.isNodeUsable(node)) online += 1;
            }
        } catch {}

        return { total, online, offline: Math.max(0, total - online) };
    }

    getNodeHealthSummary() {
        const defaultStats = this.getClusterNodeStats(this.shoukaku);
        const premiumStats = this.getClusterNodeStats(this.premiumShoukaku);
        const total = defaultStats.total + premiumStats.total;
        const online = defaultStats.online + premiumStats.online;
        const offline = Math.max(0, total - online);

        return {
            overall: {
                total,
                online,
                offline,
                allOffline: total > 0 && online === 0
            },
            default: defaultStats,
            premium: premiumStats
        };
    }

    isAnyNodeOnline() {
        return this.getNodeHealthSummary().overall.online > 0;
    }

    pickCluster(preferPremium = false) {
        if (preferPremium && this.premiumShoukaku && this.hasUsableNode(this.premiumShoukaku)) {
            return { cluster: this.premiumShoukaku, clusterType: "premium" };
        }

        if (preferPremium && this.premiumShoukaku && !this.hasUsableNode(this.premiumShoukaku)) {
            this.warnOnce("premium-fallback", "[Lavalink] Premium nodes unavailable, falling back to default node.");
        }

        return { cluster: this.shoukaku, clusterType: "default" };
    }

    get(guildId) {
        return this.states.get(guildId) || null;
    }

    async wait(ms) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async joinVoiceWithRetry(options, retries = VOICE_JOIN_RETRIES, usePremium = false) {
        let lastError = null;
        let picked = this.pickCluster(usePremium);

        const attemptJoin = async (target) => {
            for (let attempt = 1; attempt <= retries; attempt += 1) {
                try {
                    const player = await target.cluster.joinVoiceChannel(options);
                    return { player, clusterType: target.clusterType };
                } catch (error) {
                    lastError = error;
                    try {
                        await target.cluster.leaveVoiceChannel(options.guildId);
                    } catch {}

                    if (attempt < retries) {
                        await this.wait(1000 * attempt);
                    }
                }
            }

            return null;
        };

        const first = await attemptJoin(picked);
        if (first) return first;

        if (picked.clusterType === "premium") {
            this.warnOnce("premium-join-failed", "[Lavalink] Premium join failed, retrying with default node.");
            picked = { cluster: this.shoukaku, clusterType: "default" };
            const fallback = await attemptJoin(picked);
            if (fallback) return fallback;
        }

        throw lastError || new Error("Voice connection failed");
    }

    async create(guildId, voiceChannelId, textChannelId, shardId = 0, requesterId = null, options = {}) {
        let state = this.states.get(guildId);
        if (state) {
            state.textChannelId = textChannelId;
            state.voiceChannelId = voiceChannelId;
            return state;
        }

        const usePremium = requesterId
            ? await hasUserPaidPremiumAccess(requesterId).catch(() => false)
            : false;

        const joinDeaf = options?.deaf !== undefined ? Boolean(options.deaf) : true;

        const joined = await this.joinVoiceWithRetry({
            guildId,
            channelId: voiceChannelId,
            shardId,
            deaf: joinDeaf
        }, VOICE_JOIN_RETRIES, usePremium);

        state = {
            guildId,
            textChannelId,
            voiceChannelId,
            player: joined.player,
            clusterType: joined.clusterType,
            queue: [],
            current: null,
            volume: 100,
            loopMode: "off",
            isPaused: false,
            autoPausedByEmpty: false,
            skipRequested: false,
            disconnectTimer: null,
            manualDisconnect: false,
            activeFilterName: "off",
            activeFilterLabel: "Off",
            activeFilters: {}
        };

        this.bindPlayerEvents(state);
        this.states.set(guildId, state);

        try {
            await state.player.setGlobalVolume(100);
        } catch {
            await state.player.setVolume(100).catch(() => null);
        }

        return state;
    }

    clearIdleDisconnectTimer(state) {
        if (!state?.disconnectTimer) return;
        clearTimeout(state.disconnectTimer);
        state.disconnectTimer = null;
    }

    scheduleIdleDisconnect(state) {
        this.clearIdleDisconnectTimer(state);

        state.disconnectTimer = setTimeout(async () => {
            const live = this.states.get(state.guildId);
            if (!live) return;
            if (live.current || live.queue.length > 0) return;

            const keep247 = await this.shouldKeep247Live(live).catch(() => false);
            if (keep247) return;

            await this.sendContainer(live.textChannelId, {
                title: "Disconnected",
                description: "Queue is still empty. Leaving voice channel now."
            });
            await this.cleanupGuild(live.guildId, true);
        }, IDLE_DISCONNECT_MS);

        if (typeof state.disconnectTimer.unref === "function") {
            state.disconnectTimer.unref();
        }
    }

    async shouldKeep247Live(state) {
        const settings = await getGuild247Settings(state.guildId).catch(() => null);
        if (!settings?.configured) return false;

        if (!settings.premiumActive) {
            await disableGuild247(state.guildId).catch(() => null);
            await this.sendContainer(state.textChannelId, {
                title: "24/7 Disabled",
                description: "Premium expired. 24/7 mode has been turned off automatically."
            }).catch(() => null);
            return false;
        }

        return Boolean(settings.enabled);
    }

    async getAutoplayStatus(guildId) {
        return getGuildAutoplaySettings(guildId).catch(() => ({
            enabled: false,
            configured: false,
            premiumActive: false,
            byUserId: null
        }));
    }

    async setAutoplay(guildId, { enabled, userId = null }) {
        return setGuildAutoplaySettings(guildId, { enabled, userId });
    }


    normalizeTrackText(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    normalizeTrackUri(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[?&](si|feature|pp|t)=[^&#]+/g, "")
            .replace(/#.*/, "")
            .trim();
    }

    isSameTrack(a, b) {
        if (!a || !b) return false;

        const aId = String(a.identifier || "").trim();
        const bId = String(b.identifier || "").trim();
        if (aId && bId && aId === bId) return true;

        const aUri = this.normalizeTrackUri(a.uri);
        const bUri = this.normalizeTrackUri(b.uri);
        if (aUri && bUri && aUri === bUri) return true;

        const aTitle = this.normalizeTrackText(a.title);
        const bTitle = this.normalizeTrackText(b.title);
        const aAuthor = this.normalizeTrackText(a.author);
        const bAuthor = this.normalizeTrackText(b.author);

        if (aTitle && bTitle && aTitle === bTitle && aAuthor && bAuthor && aAuthor === bAuthor) {
            return true;
        }

        return false;
    }

    makeTrackFingerprint(track) {
        if (!track) return "";
        const id = String(track.identifier || "").trim();
        if (id) return `id:${id}`;

        const uri = this.normalizeTrackUri(track.uri);
        if (uri) return `uri:${uri}`;

        const title = this.normalizeTrackText(track.title);
        const author = this.normalizeTrackText(track.author);
        if (title || author) return `meta:${author}|${title}`;
        return "";
    }

    shuffleArray(list) {
        const copy = [...list];
        for (let i = copy.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    looksDevotionalTrack(track) {
        const hay = `${track?.title || ""} ${track?.author || ""}`.toLowerCase();
        const blocked = [
            "bhajan",
            "aarti",
            "aartii",
            "devotional",
            "bhakti",
            "mantra",
            "chalisa",
            "kirtan",
            "jagrata",
            "mata",
            "hanuman",
            "shiv",
            "krishna",
            "ram dhun",
            "satsang"
        ];
        return blocked.some((word) => hay.includes(word));
    }

    looksTooOldTrack(track) {
        const title = String(track?.title || "");
        const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
        if (!yearMatch) return false;
        const year = Number(yearMatch[1]);
        const currentYear = new Date().getFullYear();
        return Number.isFinite(year) && year < (currentYear - 2);
    }

    buildHindiAutoplayQueries(seedTrack) {
        const currentYear = new Date().getFullYear();
        const previousYear = currentYear - 1;
        const author = String(seedTrack?.author || "").trim();

        const baseQueries = [
            `ytmsearch:latest hindi songs ${currentYear}`,
            `ytsearch:latest hindi songs ${currentYear}`,
            `ytmsearch:new hindi songs ${currentYear}`,
            `ytsearch:new hindi songs ${currentYear}`,
            `ytmsearch:trending hindi songs ${currentYear}`,
            `ytsearch:trending hindi songs ${currentYear}`,
            `ytmsearch:new bollywood songs ${currentYear}`,
            `ytsearch:new bollywood songs ${currentYear}`,
            `ytmsearch:latest hindi songs ${previousYear} ${currentYear}`,
            `ytsearch:latest hindi songs ${previousYear} ${currentYear}`,
            `ytmsearch:hindi pop songs ${currentYear}`,
            `ytsearch:hindi pop songs ${currentYear}`
        ];

        const artistQueries = author
            ? [
                `ytmsearch:${author} latest hindi songs`,
                `ytsearch:${author} latest hindi songs`,
                `ytmsearch:${author} new song ${currentYear}`,
                `ytsearch:${author} new song ${currentYear}`
            ]
            : [];

        return this.shuffleArray([...artistQueries, ...baseQueries]);
    }

    async tryAutoplayEnqueue(state) {
        const settings = await getGuildAutoplaySettings(state.guildId).catch(() => null);
        if (!settings?.configured) return false;

        if (!settings.premiumActive) {
            await disableGuildAutoplay(state.guildId).catch(() => null);
            await this.sendContainer(state.textChannelId, {
                title: "Autoplay Disabled",
                description: "Premium expired. Autoplay has been turned off automatically."
            }).catch(() => null);
            return false;
        }

        if (!settings.enabled) return false;

        const seed = state.lastSeedTrack;
        if (!seed) return false;
        const seedKey = this.makeTrackFingerprint(seed);
        const currentKey = this.makeTrackFingerprint(state.current);
        const recentKeys = new Set(Array.isArray(state.autoplayRecentKeys) ? state.autoplayRecentKeys : []);

        const queries = this.buildHindiAutoplayQueries(seed);
        for (const q of queries) {
            const res = await this.search(q, state.guildId).catch(() => null);
            const list = this.shuffleArray(Array.isArray(res?.tracks) ? res.tracks : []);
            const pick = list.find((t) => {
                if (!t?.encoded) return false;
                if (this.isSameTrack(t, seed) || this.isSameTrack(t, state.current)) return false;
                if (this.looksDevotionalTrack(t)) return false;
                if (this.looksTooOldTrack(t)) return false;
                const key = this.makeTrackFingerprint(t);
                if (!key) return true;
                if (key === seedKey || key === currentKey) return false;
                if (recentKeys.has(key)) return false;
                return true;
            });
            if (!pick) continue;

            pick.requester = "Autoplay";
            pick.requesterId = settings.byUserId || null;
            this.enqueue(state.guildId, [pick]);

            const pickedKey = this.makeTrackFingerprint(pick);
            if (pickedKey) {
                const updated = Array.isArray(state.autoplayRecentKeys) ? state.autoplayRecentKeys : [];
                updated.push(pickedKey);
                state.autoplayRecentKeys = updated.slice(-20);
            }

            await this.sendContainer(state.textChannelId, {
                title: "Autoplay",
                description: "Queue ended, added a similar track automatically.",
                sections: [
                    { title: "Now Added", content: pick.uri ? `[${pick.title}](${pick.uri})` : pick.title },
                    { title: "Based On", content: seed.uri ? `[${seed.title}](${seed.uri})` : seed.title }
                ]
            }).catch(() => null);

            return true;
        }

        await this.sendContainer(state.textChannelId, {
            title: "Autoplay",
            description: "No similar tracks found right now."
        }).catch(() => null);

        return false;
    }

    parseEmoji(raw) {
        const value = String(raw || "").trim();
        if (!value) return null;

        const custom = value.match(/^<(a?):([\w~]+):(\d+)>$/);
        if (custom) {
            return {
                animated: custom[1] === "a",
                name: custom[2],
                id: custom[3]
            };
        }

        if (value.length <= 8) {
            return { name: value };
        }

        return { name: value, __byName: true };
    }

    async resolveEmojiForGuild(guildId, raw, fallbackUnicode) {
        const parsed = this.parseEmoji(raw);
        if (!parsed) return this.parseEmoji(fallbackUnicode);

        if (!parsed.__byName) return parsed;

        const guild = await this.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return this.parseEmoji(fallbackUnicode);

        await guild.emojis.fetch().catch(() => null);
        const match = guild.emojis.cache.find((e) => e.name === parsed.name) || null;
        if (match) {
            return {
                id: match.id,
                name: match.name,
                animated: Boolean(match.animated)
            };
        }

        return this.parseEmoji(fallbackUnicode);
    }

    async hasPremiumAccess(userId) {
        const vote = await isVotePremiumActive(userId).catch(() => false);
        const buy = await hasUserPaidPremiumAccess(userId).catch(() => false);
        return vote || buy;
    }

    buildMiniContainer(title, description, extraComponents = []) {
        return {
            flags: COMPONENTS_V2_FLAG | 64,
            components: [
                {
                    type: 17,
                    components: [
                        { type: 10, content: `## ${title}` },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: description },
                        ...extraComponents
                    ]
                }
            ]
        };
    }

    makePickerToken() {
        return Math.random().toString(36).slice(2, 10);
    }

    cleanupPickers() {
        const now = Date.now();
        for (const [key, value] of this.playlistPicker) {
            if (value.expiresAt <= now) this.playlistPicker.delete(key);
        }
    }

    snapshotTrack(track) {
        if (!track) return null;
        return {
            query: track.uri || track.title || "",
            title: track.title || "Unknown",
            uri: track.uri || null,
            author: track.author || null,
            sourceName: track.sourceName || "unknown",
            length: Number(track.length || 0)
        };
    }
    async getControlEmojis(guildId) {
        return {
            pause: await this.resolveEmojiForGuild(guildId, process.env.MUSIC_BTN_PAUSE_EMOJI, "\u23f8\ufe0f"),
            resume: await this.resolveEmojiForGuild(guildId, process.env.MUSIC_BTN_RESUME_EMOJI, "\u25b6\ufe0f"),
            skip: await this.resolveEmojiForGuild(guildId, process.env.MUSIC_BTN_SKIP_EMOJI, "\u23ed\ufe0f"),
            loop: await this.resolveEmojiForGuild(guildId, process.env.MUSIC_BTN_LOOP_EMOJI, "\ud83d\udd01"),
            stop: await this.resolveEmojiForGuild(guildId, process.env.MUSIC_BTN_STOP_EMOJI, "\u23f9\ufe0f"),
            playlist: await this.resolveEmojiForGuild(guildId, process.env.MUSIC_BTN_PLAYLIST_EMOJI, "\ud83d\udcdc"),
            favorite: await this.resolveEmojiForGuild(guildId, process.env.MUSIC_BTN_FAVORITE_EMOJI, "\u2b50")
        };
    }
    buildControlButton(label, customId, style = 2, emoji = null) {
        return {
            type: 2,
            style,
            label,
            custom_id: customId,
            ...(emoji ? { emoji } : {})
        };
    }

    async buildMusicardContainerPayload(state, cardBuffer) {
        const emoji = await this.getControlEmojis(state.guildId);

        const controlsRow1 = {
            type: 1,
            components: [
                this.buildControlButton("Pause", "musicctl:pause", 2, emoji.pause),
                this.buildControlButton("Resume", "musicctl:resume", 2, emoji.resume),
                this.buildControlButton("Skip", "musicctl:skip", 2, emoji.skip)
            ]
        };

        const controlsRow2 = {
            type: 1,
            components: [
                this.buildControlButton(state.loopMode === "off" ? "Loop Off" : "Loop On", "musicctl:loop", 1, emoji.loop),
                this.buildControlButton("Stop", "musicctl:stop", 4, emoji.stop)
            ]
        };

        const controlsRow3 = {
            type: 1,
            components: [
                this.buildControlButton("Add To Playlist", "musicctl:pladd", 2, emoji.playlist),
                this.buildControlButton("Favorite", "musicctl:fav", 2, emoji.favorite)
            ]
        };

        return {
            flags: COMPONENTS_V2_FLAG,
            components: [
                {
                    type: 17,
                    components: [
                        {
                            type: 12,
                            items: [{ media: { url: "attachment://musicard-ease.png" } }]
                        },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: "**Music Controls**" },
                        controlsRow1,
                        controlsRow2,
                        controlsRow3
                    ]
                }
            ],
            files: [
                {
                    attachment: cardBuffer,
                    name: "musicard-ease.png"
                }
            ]
        };
    }
    async buildNowPlayingPayload(state) {
        if (!state?.current) return null;

        try {
            const theme = await getActiveGuildCardTheme(state.guildId).catch(() => "ease");
            const card = await renderThemedCard({
                track: state.current,
                positionMs: Number(state.player?.position || 0),
                volume: Number(state.volume || 100),
                theme
            });

            if (card) {
                return this.buildMusicardContainerPayload(state, card);
            }
        } catch (error) {
            console.error("[Musicard Render Error]", error?.message || error);
        }

        return buildGlassWaveNowPlayingCard({
            track: state.current,
            positionMs: Number(state.player?.position || 0),
            queueSize: state.queue.length,
            volume: Number(state.volume || 100),
            loopMode: state.loopMode,
            requester: state.current.requester,
            isPaused: state.isPaused
        });
    }

    clearNowPlayingUpdates(guildId, options = {}) {
        const { deleteMessage = false } = options;
        const active = this.nowPlayingCards.get(guildId);
        if (!active) return;

        if (active.interval) {
            clearInterval(active.interval);
        }

        if (deleteMessage && active.message) {
            active.message.delete().catch(() => null);
        }

        this.nowPlayingCards.delete(guildId);
    }


    async resolveTextChannel(channelId) {
        const channel = await this.client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return null;
        return channel;
    }


    trimVoiceStatusText(text) {
        const raw = String(text || "").replace(/\s+/g, " ").trim();
        if (!raw) return "";
        return raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
    }

    buildNowPlayingVoiceStatus(track) {
        const title = this.trimVoiceStatusText(track?.title || "Unknown Track");
        return this.trimVoiceStatusText(`Now Playing: ${title}`);
    }

    async setVoiceChannelStatus(guildId, statusText) {
        if (!VOICE_STATUS_ENABLED) return;

        const state = this.states.get(guildId);
        const channelId = state?.voiceChannelId;
        if (!channelId) return;

        const nextStatus = this.trimVoiceStatusText(statusText);
        const lastStatus = this.voiceStatusCache.get(guildId);
        if (lastStatus === nextStatus) return;

        try {
            await this.client.rest.put(`/channels/${channelId}/voice-status`, {
                body: { status: nextStatus }
            });
            this.voiceStatusCache.set(guildId, nextStatus);
        } catch (error) {
            this.warnOnce(`voice-status-${guildId}`, `[Voice Status] Failed to update ${guildId}: ${error?.message || error}`, 60000);
        }
    }
    async publishNowPlayingCard(guildId) {
        const state = this.states.get(guildId);
        if (!state || !state.current) return;

        this.clearNowPlayingUpdates(guildId, { deleteMessage: true });
        this.clearIdleDisconnectTimer(state);

        const payload = await this.buildNowPlayingPayload(state);
        if (!payload) return;

        const channel = await this.resolveTextChannel(state.textChannelId);
        if (!channel) return;

        const sent = await channel.send(payload).catch(async (error) => {
            console.error("[NowPlaying Send Error]", error?.message || error);
            await this.sendContainer(state.textChannelId, {
                title: "Now Playing",
                description: state.current?.title || "Unknown Track"
            });
            return null;
        });

        if (!sent) return;

        const trackEncoded = state.current.encoded;
        const interval = setInterval(async () => {
            const latest = this.states.get(guildId);
            if (!latest || !latest.current || latest.current.encoded !== trackEncoded) {
                this.clearNowPlayingUpdates(guildId);
                return;
            }

            const updatedPayload = await this.buildNowPlayingPayload(latest);
            if (!updatedPayload) {
                this.clearNowPlayingUpdates(guildId);
                return;
            }

            const editPayload = updatedPayload.files
                ? { ...updatedPayload, attachments: [] }
                : updatedPayload;

            await sent.edit(editPayload).catch(() => null);
        }, NOW_PLAYING_UPDATE_INTERVAL_MS);

        if (typeof interval.unref === "function") interval.unref();

        this.nowPlayingCards.set(guildId, {
            trackEncoded,
            interval,
            message: sent,
            ownerUserId: state.current?.requesterId || null
        });
    }

    async refreshNowPlayingCard(guildId) {
        const state = this.states.get(guildId);
        const active = this.nowPlayingCards.get(guildId);
        if (!state || !state.current || !active?.message) return;

        const payload = await this.buildNowPlayingPayload(state);
        if (!payload) return;

        const editPayload = payload.files
            ? { ...payload, attachments: [] }
            : payload;

        await active.message.edit(editPayload).catch(() => null);
    }

    async deleteNowPlayingMessage(guildId) {
        const active = this.nowPlayingCards.get(guildId);
        if (!active?.message) return;
        await active.message.delete().catch(() => null);
    }

    toggleLoopButton(guildId) {
        const state = this.states.get(guildId);
        if (!state) return null;
        state.loopMode = state.loopMode === "off" ? "track" : "off";
        return state.loopMode;
    }

    async handleInteraction({ interaction }) {
        if (!(interaction?.isButton?.() || interaction?.isStringSelectMenu?.())) return false;
        if (!interaction.customId?.startsWith("musicctl:")) return false;

        const guildId = interaction.guildId;
        const state = this.states.get(guildId);

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("musicctl:plselect:")) {
            const token = interaction.customId.split(":")[2];
            this.cleanupPickers();
            const picker = this.playlistPicker.get(token);
            if (!picker || picker.userId !== interaction.user.id || picker.guildId !== guildId) {
                await interaction.update(this.buildMiniContainer("Picker Expired", "Playlist selector expired. Click Add To Playlist again.")).catch(() => null);
                return true;
            }

            const playlistId = interaction.values?.[0];
            if (!playlistId) {
                await interaction.update(this.buildMiniContainer("No Selection", "Select a playlist and try again.")).catch(() => null);
                return true;
            }

            await addTrack(playlistId, picker.track).catch(() => null);
            this.playlistPicker.delete(token);
            await interaction.update(this.buildMiniContainer("Added To Playlist", "Song added to selected playlist.")).catch(() => null);
            return true;
        }

        if (!interaction.isButton()) return false;

        const [, action] = interaction.customId.split(":");
        const active = this.nowPlayingCards.get(guildId);
        const ownerUserId = active?.ownerUserId || state?.current?.requesterId || null;

        if (ownerUserId && interaction.user.id !== ownerUserId) {
            await interaction.reply(this.buildMiniContainer("Not Allowed", `Only <@${ownerUserId}> can use these controls.`)).catch(() => null);
            return true;
        }

        if (!state) {
            await interaction.reply(this.buildMiniContainer("Not Connected", "No active player right now.")).catch(() => null);
            return true;
        }

        if (action === "pladd") {
            const premium = await this.hasPremiumAccess(interaction.user.id);
            if (!premium) {
                await interaction.reply(this.buildMiniContainer("Premium Required", "Vote premium ya buy premium active karo playlist controls use karne ke liye.")).catch(() => null);
                return true;
            }

            if (!state.current) {
                await interaction.reply(this.buildMiniContainer("Nothing Playing", "Koi song play nahi ho raha.")).catch(() => null);
                return true;
            }

            const playlists = await listPlaylists({ ownerUserId: interaction.user.id, guildId, scope: "user" }).catch(() => []);
            if (!playlists.length) {
                await interaction.reply(this.buildMiniContainer("No Playlists", "Pehle playlist banao: `playlist create user <name>` phir dubara click karo.")).catch(() => null);
                return true;
            }

            const token = this.makePickerToken();
            this.playlistPicker.set(token, {
                guildId,
                userId: interaction.user.id,
                track: this.snapshotTrack(state.current),
                expiresAt: Date.now() + (5 * 60 * 1000)
            });

            const options = playlists.slice(0, 25).map((pl) => ({
                label: pl.name.length > 90 ? `${pl.name.slice(0, 87)}...` : pl.name,
                value: pl.id,
                description: "Tap to add current song"
            }));

            const pickerPayload = this.buildMiniContainer("Select Playlist", "Choose playlist where this current song should be saved.", [
                {
                    type: 1,
                    components: [
                        {
                            type: 3,
                            custom_id: `musicctl:plselect:${token}`,
                            placeholder: "Select playlist",
                            options
                        }
                    ]
                }
            ]);

            await interaction.reply(pickerPayload).catch(() => null);
            return true;
        }

        if (action === "fav") {
            const premium = await this.hasPremiumAccess(interaction.user.id);
            if (!premium) {
                await interaction.reply(this.buildMiniContainer("Premium Required", "Vote premium ya buy premium active karo favorite controls use karne ke liye.")).catch(() => null);
                return true;
            }

            if (!state.current) {
                await interaction.reply(this.buildMiniContainer("Nothing Playing", "Koi song play nahi ho raha.")).catch(() => null);
                return true;
            }

            const result = await addFavorite(interaction.user.id, {
                query: state.current.uri || state.current.title,
                title: state.current.title,
                uri: state.current.uri,
                author: state.current.author,
                sourceName: state.current.sourceName,
                length: state.current.length
            }).catch(() => ({ added: false, duplicate: false, error: true }));

            if (result?.error) {
                await interaction.reply(this.buildMiniContainer("Favorite Failed", "Unable to save this song right now.")).catch(() => null);
                return true;
            }

            if (result.duplicate) {
                await interaction.reply(this.buildMiniContainer("Already Favorite", "Yeh track pehle se favorites me hai.")).catch(() => null);
                return true;
            }

            await interaction.reply(this.buildMiniContainer("Added To Favorites", state.current.uri ? `[${state.current.title}](${state.current.uri})` : state.current.title)).catch(() => null);
            return true;
        }

        await interaction.deferUpdate().catch(() => null);

        if (action === "pause") {
            await this.pause(guildId);
            await this.refreshNowPlayingCard(guildId);
            return true;
        }

        if (action === "resume") {
            await this.resume(guildId);
            await this.refreshNowPlayingCard(guildId);
            return true;
        }

        if (action === "skip") {
            await this.skip(guildId);
            return true;
        }

        if (action === "loop") {
            this.toggleLoopButton(guildId);
            await this.refreshNowPlayingCard(guildId);
            return true;
        }

        if (action === "stop") {
            await this.stop(guildId);
            return true;
        }

        return true;
    }
    bindPlayerEvents(state) {
        const { player, guildId } = state;        const recoverFromPlaybackIssue = async (title, reason) => {
            if (title === "Track Stuck" && state.current && !state.current.__stuckRecoveryTried) {
                state.current.__stuckRecoveryTried = true;

                const refreshQuery = [state.current.title, state.current.author].filter(Boolean).join(" ").trim();
                if (refreshQuery) {
                    const refreshed = await this.search(`ytmsearch:${refreshQuery}`, guildId).catch(() => null);
                    const fallbackTrack = Array.isArray(refreshed?.tracks) ? refreshed.tracks.find((t) => t?.encoded) : null;

                    if (fallbackTrack?.encoded) {
                        fallbackTrack.requester = state.current.requester;
                        fallbackTrack.requesterId = state.current.requesterId;
                        fallbackTrack.__stuckRecoveryTried = true;
                        state.current = fallbackTrack;
                        state.isPaused = false;
        state.autoPausedByEmpty = false;

                        try {
                            await state.player.playTrack({ track: { encoded: fallbackTrack.encoded } });
                            await this.sendContainer(state.textChannelId, {
                                title: "Playback Recovered",
                                description: "Source refreshed automatically. Continuing playback.",
                                sections: [{ title: "Track", content: fallbackTrack.uri ? `[${fallbackTrack.title}](${fallbackTrack.uri})` : fallbackTrack.title }]
                            });
                            return;
                        } catch {}
                    }
                }
            }

            this.clearNowPlayingUpdates(guildId, { deleteMessage: true });
            await this.sendContainer(state.textChannelId, {
                title,
                description: "Moving to the next track in queue.",
                sections: [{ title: "Reason", content: String(reason || "Unknown") }]
            });
            state.skipRequested = false;
            state.current = null;
            state.isPaused = false;
        state.autoPausedByEmpty = false;
            await this.playNext(guildId);
        };

        player.on("start", async () => {
            if (!state.current) return;
            await this.publishNowPlayingCard(guildId);
        });

        player.on("end", async (data) => {
            const reason = data?.reason || "unknown";
            const replayableEnd = reason === "finished" || reason === "loadFailed";
            const skipped = state.skipRequested === true;

            if (state.current && replayableEnd && !skipped) {
                if (state.loopMode === "track") {
                    state.queue.unshift(state.current);
                } else if (state.loopMode === "queue") {
                    state.queue.push(state.current);
                }
            }

            state.skipRequested = false;
            state.current = null;
            state.isPaused = false;
        state.autoPausedByEmpty = false;
            this.clearNowPlayingUpdates(guildId, { deleteMessage: true });
            await this.playNext(guildId);
        });

        player.on("closed", async () => {
            this.clearNowPlayingUpdates(guildId);

            const live = this.states.get(guildId);
            if (live?.manualDisconnect) {
                live.manualDisconnect = false;
                return;
            }

            await this.cleanupGuild(guildId, true);
        });

        player.on("exception", async (data) => {
            const reason = data?.exception?.message || data?.error || "Track exception";
            await recoverFromPlaybackIssue("Playback Error", reason);
        });

        player.on("stuck", async (data) => {
            const threshold = data?.thresholdMs ? `${data.thresholdMs}ms` : "Unknown threshold";
            await recoverFromPlaybackIssue("Track Stuck", threshold);
        });
    }

    async search(query, guildId = null) {
        const state = guildId ? this.states.get(guildId) : null;
        const preferPremium = state?.clusterType === "premium";
        const picked = this.pickCluster(preferPremium);
        const cluster = picked.cluster;

        const nodes = [];
        try {
            const ideal = cluster.getIdealNode?.();
            if (ideal) nodes.push(ideal);
        } catch {}
        try {
            for (const n of cluster.nodes.values()) {
                if (!nodes.includes(n)) nodes.push(n);
            }
        } catch {}

        const node = nodes.find((n) => this.isNodeUsable(n)) || nodes[0] || null;
        if (!node) {
            return { loadType: "error", tracks: [], exception: { message: "No Lavalink node available" } };
        }

        const result = await node.rest.resolve(query).catch((err) => {
            return { loadType: "error", exception: { message: err?.message || "Resolve failed" } };
        });

        return this.normalizeLoadResult(result);
    }

    normalizeLoadResult(result) {
        const loadType = String(result?.loadType || "empty").toLowerCase();

        if (loadType === "track") {
            return {
                loadType: "track",
                tracks: [this.mapTrack(result.data)]
            };
        }

        if (loadType === "search") {
            const rawTracks = Array.isArray(result?.data)
                ? result.data
                : Array.isArray(result?.data?.tracks)
                    ? result.data.tracks
                    : [];
            const tracks = rawTracks.map((t) => this.mapTrack(t));
            return {
                loadType,
                tracks,
                playlistName: null
            };
        }

        if (loadType === "playlist") {
            const rawTracks = Array.isArray(result?.data?.tracks) ? result.data.tracks : [];
            const tracks = rawTracks.map((t) => this.mapTrack(t));
            return {
                loadType,
                tracks,
                playlistName: result?.data?.info?.name || null
            };
        }

        if (loadType === "error") {
            return {
                loadType: "error",
                tracks: [],
                exception: result?.data || result?.exception || { message: "Unknown Lavalink error" }
            };
        }

        return { loadType: "empty", tracks: [] };
    }

    mapTrack(track) {
        return {
            encoded: track.encoded,
            identifier: track.info?.identifier || null,
            title: track.info?.title || "Unknown",
            author: track.info?.author || "Unknown",
            length: Number(track.info?.length || 0),
            uri: track.info?.uri || null,
            artworkUrl: track.info?.artworkUrl || null,
            sourceName: track.info?.sourceName || "unknown",
            requester: null,
            requesterId: null
        };
    }

    enqueue(guildId, tracks) {
        const state = this.states.get(guildId);
        if (!state) return 0;

        this.clearIdleDisconnectTimer(state);
        state.queue.push(...tracks);
        return tracks.length;
    }

    async playNext(guildId) {
        const state = this.states.get(guildId);
        if (!state) return;

        const next = state.queue.shift();
        if (!next) {
            this.clearNowPlayingUpdates(guildId, { deleteMessage: true });

            const autoAdded = await this.tryAutoplayEnqueue(state).catch(() => false);
            if (autoAdded) {
                await this.playNext(guildId);
                return;
            }

            const keep247 = await this.shouldKeep247Live(state).catch(() => false);
            if (keep247) {
                await this.sendContainer(state.textChannelId, {
                    title: "Queue Ended",
                    description: "24/7 mode is enabled. Staying connected in voice channel.",
                    footer: "Use 247 off to disable always-on mode"
                });
                return;
            }

            await this.sendContainer(state.textChannelId, {
                title: "Queue Ended",
                description: "Queue is empty. Disconnecting in 10 seconds if no new song is added.",
                footer: "Use play quickly to keep the bot in voice."
            });
            this.scheduleIdleDisconnect(state);
            return;
        }

        this.clearIdleDisconnectTimer(state);

        state.current = next;
        state.lastSeedTrack = { ...next };
        state.isPaused = false;
        state.autoPausedByEmpty = false;

        try {
            await state.player.playTrack({
                track: { encoded: next.encoded }
            });
        } catch (error) {
            const reason = error?.message || error?.error || "Unknown playback error";
            await this.sendContainer(state.textChannelId, {
                title: "Playback Error",
                description: "Failed to start this track.",
                sections: [{ title: "Reason", content: String(reason) }]
            });
            state.current = null;
            state.isPaused = false;
        state.autoPausedByEmpty = false;
            this.clearNowPlayingUpdates(guildId, { deleteMessage: true });
            await this.playNext(guildId);
        }
    }

    async playIfIdle(guildId) {
        const state = this.states.get(guildId);
        if (!state) return;

        if (state.queue.length > 0) {
            this.clearIdleDisconnectTimer(state);
        }

        if (!state.current) await this.playNext(guildId);
    }

    async pause(guildId) {
        const state = this.states.get(guildId);
        if (!state || !state.current || state.isPaused) return false;
        await state.player.setPaused(true);
        state.isPaused = true;
        state.autoPausedByEmpty = false;
        return true;
    }

    async resume(guildId) {
        const state = this.states.get(guildId);
        if (!state || !state.current || !state.isPaused) return false;
        await state.player.setPaused(false);
        state.isPaused = false;
        state.autoPausedByEmpty = false;
        return true;
    }

    async skip(guildId) {
        const state = this.states.get(guildId);
        if (!state || !state.current) return false;
        state.skipRequested = true;
        this.clearNowPlayingUpdates(guildId, { deleteMessage: true });

        try {
            await state.player.stopTrack();
        } catch {
            await state.player.stop();
        }
        return true;
    }

    async stop(guildId) {
        const state = this.states.get(guildId);
        if (!state) return false;
        state.queue = [];
        state.loopMode = "off";
        state.skipRequested = true;
        state.current = null;
        state.isPaused = false;
        state.autoPausedByEmpty = false;
        this.clearNowPlayingUpdates(guildId, { deleteMessage: true });
        this.clearIdleDisconnectTimer(state);

        try {
            await state.player.stopTrack();
        } catch {
            await state.player.stop();
        }
        return true;
    }

    async disconnect(guildId) {
        const state = this.states.get(guildId);
        if (!state) return false;

        state.manualDisconnect = true;
        await this.cleanupGuild(guildId, true);
        return true;
    }

    async cleanupGuild(guildId, leaveVoice = true) {
        const state = this.states.get(guildId);
        if (!state) return;

        this.clearNowPlayingUpdates(guildId, { deleteMessage: true });
        this.clearIdleDisconnectTimer(state);

        try {
            await state.player.disconnect();
        } catch {}

        if (leaveVoice) {
            try {
                if (state.clusterType === "premium" && this.premiumShoukaku) await this.premiumShoukaku.leaveVoiceChannel(guildId); else await this.shoukaku.leaveVoiceChannel(guildId);
            } catch {}
        }

        this.voiceStatusCache.delete(guildId);
        this.states.delete(guildId);
    }

    async setVolume(guildId, volume) {
        const state = this.states.get(guildId);
        if (!state) return false;

        try {
            await state.player.setGlobalVolume(volume);
        } catch {
            await state.player.setVolume(volume);
        }

        state.volume = volume;
        return true;
    }
    getFilterStatus(guildId) {
        const state = this.states.get(guildId);
        if (!state) return { name: "off", label: "Off", filters: {} };

        return {
            name: state.activeFilterName || "off",
            label: state.activeFilterLabel || "Off",
            filters: state.activeFilters || {}
        };
    }

    async applyFilter(guildId, filterName) {
        const state = this.states.get(guildId);
        if (!state?.player) return { ok: false, reason: "No active player." };

        const preset = getFilterPreset(filterName);
        if (!preset) return { ok: false, reason: "Unknown filter preset." };

        try {
            await state.player.setFilters(preset.filters || {});
            state.activeFilterName = preset.name;
            state.activeFilterLabel = preset.label || preset.name;
            state.activeFilters = preset.filters || {};
            await this.refreshNowPlayingCard(guildId).catch(() => null);
            return { ok: true, name: preset.name, label: state.activeFilterLabel };
        } catch (error) {
            return { ok: false, reason: String(error?.message || error) };
        }
    }

    async clearFilters(guildId) {
        const state = this.states.get(guildId);
        if (!state?.player) return false;

        try {
            await state.player.clearFilters();
            state.activeFilterName = "off";
            state.activeFilterLabel = "Off";
            state.activeFilters = {};
            await this.refreshNowPlayingCard(guildId).catch(() => null);
            return true;
        } catch {
            return false;
        }
    }
    cycleLoop(guildId) {
        const state = this.states.get(guildId);
        if (!state) return null;

        if (state.loopMode === "off") state.loopMode = "track";
        else if (state.loopMode === "track") state.loopMode = "queue";
        else state.loopMode = "off";

        return state.loopMode;
    }

    getQueue(guildId) {
        const state = this.states.get(guildId);
        if (!state) return null;
        return {
            current: state.current,
            upcoming: [...state.queue],
            total: state.queue.length
        };
    }

    getNowPlaying(guildId) {
        const state = this.states.get(guildId);
        if (!state || !state.current) return null;
        return {
            track: state.current,
            position: Number(state.player.position || 0)
        };
    }
}

module.exports = { MusicManager };












