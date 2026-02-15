const { PermissionFlagsBits } = require("discord.js");
const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("../premium/profile");
const {
    createPlaylist,
    getPlaylistById,
    findPlaylist,
    listPlaylists,
    deletePlaylist,
    getTracks,
    addTrack,
    removeTrackAt,
    clearTracks,
    getSettings,
    setSettings
} = require("./store");

const MAX_LIST_TEXT = 3500;

async function hasPlaylistPremium(userId) {
    const vote = await isVotePremiumActive(userId).catch(() => false);
    const buy = await hasUserPaidPremiumAccess(userId).catch(() => false);
    return vote || buy;
}

function normalizeScope(input) {
    return String(input || "").toLowerCase() === "shared" ? "shared" : "user";
}

function parseScopeArg(args) {
    if (!args.length) return { scope: "user", rest: args };
    const head = String(args[0] || "").toLowerCase();
    if (head === "shared" || head === "user") {
        return { scope: head, rest: args.slice(1) };
    }
    return { scope: "user", rest: args };
}

function short(text, max = 120) {
    const v = String(text || "").trim();
    if (v.length <= max) return v;
    return `${v.slice(0, max - 3)}...`;
}

function toLinkedTrack(t) {
    const name = short(t.title || t.query || "Unknown", 95);
    return t.uri ? `[${name}](${t.uri})` : name;
}

async function ensurePremiumOrReply(userId, reply) {
    const ok = await hasPlaylistPremium(userId);
    if (ok) return true;

    await reply({
        title: "Premium Required",
        description: "Playlists use karne ke liye vote premium ya buy premium active hona chahiye."
    });
    return false;
}

async function ensureSharedWriteOrReply(scope, hasManageGuild, reply) {
    if (scope !== "shared") return true;
    if (hasManageGuild) return true;

    await reply({
        title: "Permission Required",
        description: "Shared playlist manage karne ke liye Manage Server permission chahiye."
    });
    return false;
}

function parsePlaylistId(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    const legacy = raw.match(/^hima-playlist:\/\/([a-zA-Z0-9_-]+)$/i);
    if (legacy) return legacy[1];

    if (/^pl_[a-zA-Z0-9_-]+$/.test(raw)) return raw;
    return null;
}


function getQueueTracks(bot, guildId) {
    const q = bot.music.getQueue(guildId);
    if (!q) return [];
    const all = [];
    if (q.current) all.push(q.current);
    if (Array.isArray(q.upcoming)) all.push(...q.upcoming);
    return all;
}
function formatPlaylistLines(items, scope) {
    let out = "";
    for (let i = 0; i < items.length; i += 1) {
        const row = items[i];
        const line = `${i + 1}. **${short(row.name, 75)}** (${scope})\n`;
        if ((out + line).length > MAX_LIST_TEXT) break;
        out += line;
    }
    return out.trim() || "No playlists found.";
}

async function resolveOrCreatePlaylist({ userId, guildId, scope, name, createIfMissing = false }) {
    let pl = await findPlaylist({ ownerUserId: userId, guildId, scope, name });
    if (!pl && createIfMissing) {
        pl = await createPlaylist({ ownerUserId: userId, guildId, scope, name });
    }
    return pl;
}

async function searchTrack(bot, guildId, query) {
    const isUrl = /^https?:\/\//i.test(query);
    const seed = isUrl ? query : `ytsearch:${query}`;
    const res = await bot.music.search(seed, guildId);
    if (!res || res.loadType === "empty" || res.loadType === "error" || !res.tracks?.length) return null;
    return res.tracks[0];
}

async function loadPlaylistIntoQueue({ bot, message, playlist, tracks }) {
    const voice = message.member?.voice?.channel;
    if (!voice) throw new Error("Join a voice channel before loading playlist.");

    const me = message.guild.members.me;
    const perms = voice.permissionsFor(me);
    if (!perms?.has("Connect") || !perms?.has("Speak")) {
        throw new Error("I need Connect and Speak permission in your voice channel.");
    }

    const shardId = message.guild.shardId || 0;
    let state = bot.music.get(message.guild.id);

    if (state) {
        const activeVoiceId = state.voiceChannelId || message.guild.members.me?.voice?.channelId || null;
        if (activeVoiceId && activeVoiceId !== voice.id) {
            const canForceMove = await bot.music.hasPremiumAccess(message.author.id).catch(() => false);
            if (!canForceMove) {
                throw new Error(`I am already active in <#${activeVoiceId}>. Join that voice channel first.`);
            }

            await bot.music.disconnect(message.guild.id).catch(() => null);
            state = null;
        } else {
            bot.music.setPlaybackTextChannel(message.guild.id, message.channel.id);
        }
    }

    if (state && (!state.player || !state.voiceChannelId)) {
        state = null;
    }

    if (!state) {
        state = await bot.music.create(
            message.guild.id,
            voice.id,
            message.channel.id,
            shardId,
            message.author.id,
            { updateTextChannel: true, forceReconnect: true }
        );
    }

    bot.music.setPlaybackTextChannel(message.guild.id, message.channel.id);
    let added = 0;
    let failed = 0;
    for (const t of tracks) {
        const q = t.uri || t.query || t.title;
        if (!q) {
            failed += 1;
            continue;
        }
        const found = await searchTrack(bot, message.guild.id, q).catch(() => null);
        if (!found) {
            failed += 1;
            continue;
        }
        found.requester = message.author.tag;
        found.requesterId = message.author.id;
        bot.music.enqueue(message.guild.id, [found]);
        added += 1;
    }

    await bot.music.playIfIdle(message.guild.id);
    return { added, failed, name: playlist.name };
}

async function parseImportedJson(message, urlOrText) {
    const attachment = message.attachments?.first?.();

    let raw = String(urlOrText || "").trim();
    if (!raw && attachment?.url) {
        raw = attachment.url;
    }

    if (!raw) throw new Error("Provide JSON text, URL, or attach a .json file.");

    if (/^https?:\/\//i.test(raw)) {
        const res = await fetch(raw);
        if (!res.ok) throw new Error(`Import URL failed (${res.status})`);
        raw = await res.text();
    }

    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error("Import JSON must be an array of tracks.");

    return data
        .map((x) => ({
            query: String(x.query || x.uri || x.title || "").trim(),
            title: x.title ? String(x.title) : null,
            uri: x.uri ? String(x.uri) : null,
            source: x.source ? String(x.source) : null,
            lengthMs: Number(x.lengthMs || x.length_ms || 0) || null
        }))
        .filter((x) => x.query);
}

async function importFromPlaylistId(targetPlaylistId, sourcePlaylistId) {
    const src = await getPlaylistById(sourcePlaylistId);
    if (!src) return { ok: false, reason: "Playlist ID invalid hai." };

    const srcTracks = await getTracks(src.id);
    if (!srcTracks.length) return { ok: false, reason: "Source playlist empty hai." };

    for (const t of srcTracks) {
        await addTrack(targetPlaylistId, {
            query: t.query,
            title: t.title,
            uri: t.uri,
            source: t.source,
            lengthMs: t.length_ms
        });
    }

    return { ok: true, count: srcTracks.length, sourceName: src.name };
}

module.exports = {
    name: "playlist",
    aliases: ["pl"],
    description: "Premium cloud playlists: save/load/share/import/export/autosync/autoload.",
    usage: "playlist <create|list|view|add|addqueue|remove|clear|delete|load|import|export|share|autosync|autoload> ...",
    async execute({ bot, message, args, reply }) {
        const sub = String(args[0] || "").toLowerCase();
        if (!sub) {
            await reply({
                title: "Playlist Help",
                description: "Premium cloud playlist commands.",
                fields: [
                    { name: "Create", value: "playlist create [user|shared] <name>" },
                    { name: "List", value: "playlist list [user|shared]" },
                    { name: "Add", value: "playlist add [user|shared] <name> <query/url|playlistId>" },
                    { name: "Add Queue", value: "playlist addqueue [user|shared] <name>" },
                    { name: "Load", value: "playlist load [user|shared] <name>" },
                    { name: "Share/Import ID", value: "playlist share [user|shared] <name> / playlist import [user|shared] <name> <playlistId>" },
                    { name: "Autosync", value: "playlist autosync <on|off> [playlistName]" },
                    { name: "Autoload", value: "playlist autoload <name|off>" }
                ]
            });
            return;
        }

        const premium = await ensurePremiumOrReply(message.author.id, reply);
        if (!premium) return;

        const hasManageGuild = Boolean(message.member?.permissions?.has(PermissionFlagsBits.ManageGuild));

        if (sub === "create") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            if (!(await ensureSharedWriteOrReply(scope, hasManageGuild, reply))) return;

            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist create [user|shared] <name>`" });
                return;
            }

            const existing = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (existing) {
                await reply({ title: "Already Exists", description: "Is naam ka playlist already bana hua hai." });
                return;
            }

            await createPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            await reply({ title: "Playlist Created", description: `Created **${name}** (${scope}).` });
            return;
        }

        if (sub === "list") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);

            const items = await listPlaylists({ ownerUserId: message.author.id, guildId: message.guild.id, scope });
            if (!items.length) {
                await reply({ title: "No Playlists", description: `No ${scope} playlists found.` });
                return;
            }

            await reply({
                title: `${scope === "shared" ? "Shared" : "Your"} Playlists`,
                description: formatPlaylistLines(items, scope),
                footer: `${items.length} total`
            });
            return;
        }

        if (sub === "view") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist view [user|shared] <name>`" });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (!pl) {
                await reply({ title: "Not Found", description: "Playlist not found." });
                return;
            }

            const tracks = await getTracks(pl.id);
            if (!tracks.length) {
                await reply({ title: `${pl.name}`, description: "Playlist is empty." });
                return;
            }

            let text = "";
            for (let i = 0; i < tracks.length; i += 1) {
                const line = `${i + 1}. ${toLinkedTrack(tracks[i])}\n`;
                if ((text + line).length > MAX_LIST_TEXT) break;
                text += line;
            }

            await reply({ title: `${pl.name}`, description: text.trim(), footer: `Tracks: ${tracks.length}` });
            return;
        }

        if (sub === "add") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            if (!(await ensureSharedWriteOrReply(scope, hasManageGuild, reply))) return;

            const name = String(parsed.rest[0] || "").trim();
            const query = parsed.rest.slice(1).join(" ").trim();
            if (!name || !query) {
                await reply({ title: "Missing Arguments", description: "Usage: `playlist add [user|shared] <name> <query/url|playlistId>`" });
                return;
            }

            const pl = await resolveOrCreatePlaylist({ userId: message.author.id, guildId: message.guild.id, scope, name, createIfMissing: true });

            const sourcePlaylistId = parsePlaylistId(query);
            if (sourcePlaylistId) {
                const imported = await importFromPlaylistId(pl.id, sourcePlaylistId);
                if (!imported.ok) {
                    await reply({ title: "Import Failed", description: imported.reason });
                    return;
                }

                await reply({
                    title: "Playlist Merged",
                    description: `Imported ${imported.count} tracks from **${imported.sourceName}** into **${pl.name}**.`
                });
                return;
            }

            const track = await searchTrack(bot, message.guild.id, query);
            if (!track) {
                await reply({ title: "No Result", description: "Track not found. Try another query." });
                return;
            }

            await addTrack(pl.id, {
                query,
                title: track.title,
                uri: track.uri,
                source: track.sourceName,
                lengthMs: track.length
            });

            await reply({ title: "Track Saved", description: `Added to **${pl.name}** (${scope}).` });
            return;
        }

        if (sub === "addqueue" || sub === "queueadd") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            if (!(await ensureSharedWriteOrReply(scope, hasManageGuild, reply))) return;

            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist addqueue [user|shared] <name>`" });
                return;
            }

            const pl = await resolveOrCreatePlaylist({ userId: message.author.id, guildId: message.guild.id, scope, name, createIfMissing: true });
            const queueTracks = getQueueTracks(bot, message.guild.id);

            if (!queueTracks.length) {
                await reply({ title: "Queue Empty", description: "Queue me koi track nahi hai." });
                return;
            }

            let added = 0;
            for (const t of queueTracks) {
                await addTrack(pl.id, {
                    query: t.uri || t.title,
                    title: t.title,
                    uri: t.uri,
                    source: t.sourceName,
                    lengthMs: t.length
                }).catch(() => null);
                added += 1;
            }

            await reply({
                title: "Queue Added To Playlist",
                description: `Saved queue tracks to **${pl.name}** (${scope}).`,
                fields: [{ name: "Added", value: String(added) }]
            });
            return;
        }
        if (sub === "remove") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            if (!(await ensureSharedWriteOrReply(scope, hasManageGuild, reply))) return;

            const name = String(parsed.rest[0] || "").trim();
            const idx = Number(parsed.rest[1]);
            if (!name || !idx) {
                await reply({ title: "Missing Arguments", description: "Usage: `playlist remove [user|shared] <name> <index>`" });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (!pl) {
                await reply({ title: "Not Found", description: "Playlist not found." });
                return;
            }

            await removeTrackAt(pl.id, idx);
            await reply({ title: "Track Removed", description: `Removed item #${idx} from **${pl.name}**.` });
            return;
        }

        if (sub === "clear") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            if (!(await ensureSharedWriteOrReply(scope, hasManageGuild, reply))) return;

            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist clear [user|shared] <name>`" });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (!pl) {
                await reply({ title: "Not Found", description: "Playlist not found." });
                return;
            }

            await clearTracks(pl.id);
            await reply({ title: "Playlist Cleared", description: `Removed all tracks from **${pl.name}**.` });
            return;
        }

        if (sub === "delete") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            if (!(await ensureSharedWriteOrReply(scope, hasManageGuild, reply))) return;

            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist delete [user|shared] <name>`" });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (!pl) {
                await reply({ title: "Not Found", description: "Playlist not found." });
                return;
            }

            await deletePlaylist(pl.id);
            await reply({ title: "Playlist Deleted", description: `Deleted **${name}** (${scope}).` });
            return;
        }

        if (sub === "load") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist load [user|shared] <name>`" });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (!pl) {
                await reply({ title: "Not Found", description: "Playlist not found." });
                return;
            }

            const tracks = await getTracks(pl.id);
            if (!tracks.length) {
                await reply({ title: "Empty Playlist", description: "Playlist is empty." });
                return;
            }

            const out = await loadPlaylistIntoQueue({ bot, message, playlist: pl, tracks });
            await reply({
                title: "Playlist Loaded",
                description: `Loaded **${pl.name}** to queue.`,
                fields: [
                    { name: "Added", value: String(out.added) },
                    { name: "Failed", value: String(out.failed) }
                ]
            });
            return;
        }

        if (sub === "export") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist export [user|shared] <name>`" });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (!pl) {
                await reply({ title: "Not Found", description: "Playlist not found." });
                return;
            }

            const tracks = await getTracks(pl.id);
            const payload = JSON.stringify(tracks.map((t) => ({
                query: t.query,
                title: t.title,
                uri: t.uri,
                source: t.source,
                lengthMs: t.length_ms
            })), null, 2);

            const buffer = Buffer.from(payload, "utf8");
            await message.reply({
                flags: 1 << 15,
                components: [
                    {
                        type: 17,
                        components: [
                            { type: 10, content: "## Playlist Export" },
                            { type: 14, divider: true, spacing: 1 },
                            { type: 10, content: `Exported **${pl.name}** (${tracks.length} tracks).` }
                        ]
                    }
                ],
                files: [{ attachment: buffer, name: `${pl.name.replace(/\s+/g, "_")}.json` }]
            });
            return;
        }

        if (sub === "share") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            const name = parsed.rest.join(" ").trim();
            if (!name) {
                await reply({ title: "Missing Name", description: "Usage: `playlist share [user|shared] <name>`" });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope, name });
            if (!pl) {
                await reply({ title: "Not Found", description: "Playlist not found." });
                return;
            }

            await reply({
                title: "Playlist Share ID",
                description: `**Playlist ID:** \`${pl.id}\``,
                fields: [
                    { name: "How to import", value: "`playlist import [user|shared] <targetName> <playlistId>`" },
                    { name: "Quick merge", value: "`playlist add [user|shared] <targetName> <playlistId>`" }
                ]
            });
            return;
        }

        if (sub === "import") {
            const parsed = parseScopeArg(args.slice(1));
            const scope = normalizeScope(parsed.scope);
            if (!(await ensureSharedWriteOrReply(scope, hasManageGuild, reply))) return;

            const name = String(parsed.rest[0] || "").trim();
            const source = parsed.rest.slice(1).join(" ").trim();
            if (!name || !source) {
                await reply({ title: "Missing Arguments", description: "Usage: `playlist import [user|shared] <name> <playlistId|json|url>`" });
                return;
            }

            const pl = await resolveOrCreatePlaylist({ userId: message.author.id, guildId: message.guild.id, scope, name, createIfMissing: true });

            const sourcePlaylistId = parsePlaylistId(source);
            if (sourcePlaylistId) {
                const imported = await importFromPlaylistId(pl.id, sourcePlaylistId);
                if (!imported.ok) {
                    await reply({ title: "Import Failed", description: imported.reason });
                    return;
                }

                await reply({
                    title: "Playlist Imported",
                    description: `Imported ${imported.count} tracks from **${imported.sourceName}** into **${pl.name}**.`
                });
                return;
            }

            const items = await parseImportedJson(message, source);
            for (const item of items) {
                await addTrack(pl.id, item);
            }

            await reply({ title: "Playlist Imported", description: `Imported ${items.length} tracks into **${pl.name}**.` });
            return;
        }

        if (sub === "autosync") {
            const mode = String(args[1] || "").toLowerCase();
            if (!["on", "off"].includes(mode)) {
                await reply({ title: "Invalid Mode", description: "Usage: `playlist autosync <on|off> [playlistName]`" });
                return;
            }

            if (mode === "off") {
                await setSettings(message.guild.id, message.author.id, {
                    autosync_enabled: false,
                    autosync_playlist_id: null
                });
                await reply({ title: "Auto-Sync Disabled", description: "Play command tracks auto-save band ho gaya." });
                return;
            }

            const name = args.slice(2).join(" ").trim() || "AutoSync";
            const pl = await resolveOrCreatePlaylist({
                userId: message.author.id,
                guildId: message.guild.id,
                scope: "user",
                name,
                createIfMissing: true
            });

            await setSettings(message.guild.id, message.author.id, {
                autosync_enabled: true,
                autosync_playlist_id: pl.id
            });

            await reply({ title: "Auto-Sync Enabled", description: `New played tracks auto-save honge **${pl.name}** me.` });
            return;
        }

        if (sub === "autoload" || sub === "default") {
            const value = args.slice(1).join(" ").trim();
            if (!value) {
                await reply({ title: "Missing Value", description: "Usage: `playlist autoload <name|off>`" });
                return;
            }

            if (value.toLowerCase() === "off") {
                await setSettings(message.guild.id, message.author.id, { autoload_playlist_id: null });
                await reply({ title: "Auto-Load Disabled", description: "Default playlist autoload band ho gaya." });
                return;
            }

            const pl = await findPlaylist({ ownerUserId: message.author.id, guildId: message.guild.id, scope: "user", name: value });
            if (!pl) {
                await reply({ title: "Not Found", description: "User playlist not found for autoload." });
                return;
            }

            await setSettings(message.guild.id, message.author.id, { autoload_playlist_id: pl.id });
            await reply({ title: "Default Playlist Set", description: `Auto-load playlist set to **${pl.name}**.` });
            return;
        }

        await reply({ title: "Unknown Subcommand", description: "Use `playlist` to see all available options." });
    },

    async autoSyncFromPlay({ message, tracks }) {
        if (!message?.guild || !message?.author || !Array.isArray(tracks) || !tracks.length) return;

        const premium = await hasPlaylistPremium(message.author.id).catch(() => false);
        if (!premium) return;

        const settings = await getSettings(message.guild.id, message.author.id).catch(() => null);
        if (!settings?.autosync_enabled || !settings?.autosync_playlist_id) return;

        for (const t of tracks) {
            await addTrack(settings.autosync_playlist_id, {
                query: t.uri || t.title,
                title: t.title,
                uri: t.uri,
                source: t.sourceName,
                lengthMs: t.length
            }).catch(() => null);
        }
    },

    async tryAutoLoadOnVoiceJoin({ bot, guild, member, channel }) {
        if (!guild || !member || !channel || member.user.bot) return false;

        const premium = await hasPlaylistPremium(member.id).catch(() => false);
        if (!premium) return false;

        const settings = await getSettings(guild.id, member.id).catch(() => null);
        if (!settings?.autoload_playlist_id) return false;

        const tracks = await getTracks(settings.autoload_playlist_id).catch(() => []);
        if (!tracks.length) return false;

        const textChannel = guild.systemChannel && guild.systemChannel.isTextBased()
            ? guild.systemChannel
            : guild.channels.cache.find((c) => c.isTextBased() && c.viewable) || null;

        if (!textChannel) return false;

        const fakeMessage = {
            guild,
            guildId: guild.id,
            member,
            author: member.user,
            channel: textChannel,
            channelId: textChannel.id,
            reply: async (payload) => textChannel.send(payload)
        };

        const out = await loadPlaylistIntoQueue({
            bot,
            message: fakeMessage,
            playlist: { name: "AutoLoad" },
            tracks
        }).catch(() => null);

        if (!out || out.added < 1) return false;

        await textChannel.send({
            flags: 1 << 15,
            components: [
                {
                    type: 17,
                    components: [
                        { type: 10, content: "## Auto-Loaded Playlist" },
                        { type: 14, divider: true, spacing: 1 },
                        { type: 10, content: `Loaded ${out.added} tracks for <@${member.id}>` }
                    ]
                }
            ]
        }).catch(() => null);

        return true;
    }
};
