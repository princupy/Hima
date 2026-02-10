const { isVotePremiumActive, hasUserPaidPremiumAccess } = require("../premium/profile");
const {
    addFavorite,
    listFavorites,
    getFavoriteByIndex,
    removeFavoriteByIndex
} = require("./store");

const MAX_LIST_TEXT = 3600;

async function hasPremium(userId) {
    const vote = await isVotePremiumActive(userId).catch(() => false);
    const buy = await hasUserPaidPremiumAccess(userId).catch(() => false);
    return vote || buy;
}

function toLine(item, index) {
    const name = item.title || item.query || "Unknown";
    const short = name.length > 95 ? `${name.slice(0, 92)}...` : name;
    return item.uri
        ? `${index}. [${short}](${item.uri})`
        : `${index}. ${short}`;
}

function getQueueTracks(bot, guildId) {
    const q = bot.music.getQueue(guildId);
    if (!q) return [];
    const all = [];
    if (q.current) all.push(q.current);
    if (Array.isArray(q.upcoming)) all.push(...q.upcoming);
    return all;
}

function buildFavoriteSearchCandidates(item) {
    const title = String(item?.title || "").trim();
    const author = String(item?.author || "").trim();
    const query = String(item?.query || "").trim();
    const uri = String(item?.uri || "").trim();

    const textSeed = [title, author].filter(Boolean).join(" ").trim();
    const q = [];

    if (textSeed) {
        q.push(`ytmsearch:${textSeed}`);
        q.push(`ytsearch:${textSeed}`);
    }

    if (title) {
        q.push(`ytmsearch:${title}`);
        q.push(`ytsearch:${title}`);
    }

    if (query && !/^https?:\/\//i.test(query)) {
        q.push(`ytmsearch:${query}`);
        q.push(`ytsearch:${query}`);
    }

    if (uri) q.push(uri);

    return [...new Set(q.filter(Boolean))];
}

async function resolveFavoriteTrack(bot, guildId, item) {
    const candidates = buildFavoriteSearchCandidates(item);
    for (const candidate of candidates) {
        const res = await bot.music.search(candidate, guildId).catch(() => null);
        if (!res || res.loadType === "empty" || res.loadType === "error" || !res.tracks?.length) continue;
        return res.tracks[0];
    }
    return null;
}
module.exports = {
    name: "favorite",
    aliases: ["fav", "favs"],
    description: "Premium favorites: add/list/play/remove your saved tracks.",
    usage: "favorite <add|list|play|remove|addqueue> [query|index]",

    async execute({ bot, message, args, reply }) {
        const ok = await hasPremium(message.author.id);
        if (!ok) {
            await reply({ title: "Premium Required", description: "Favorites vote premium ya buy premium users ke liye hai." });
            return;
        }

        const sub = String(args[0] || "list").toLowerCase();

        if (sub === "add") {
            const query = args.slice(1).join(" ").trim();
            let track = null;

            if (query) {
                const isUrl = /^https?:\/\//i.test(query);
                const res = await bot.music.search(isUrl ? query : `ytsearch:${query}`, message.guild.id).catch(() => null);
                if (!res || res.loadType === "empty" || res.loadType === "error" || !res.tracks?.length) {
                    await reply({ title: "No Result", description: "Track not found for favorite add." });
                    return;
                }
                track = res.tracks[0];
            } else {
                const state = bot.music.get(message.guild.id);
                if (!state?.current) {
                    await reply({ title: "Nothing Playing", description: "Play a song or pass query: `favorite add <song>`" });
                    return;
                }
                track = state.current;
            }

            const result = await addFavorite(message.author.id, track);
            if (result.duplicate) {
                await reply({ title: "Already In Favorites", description: "Yeh track pehle se favorite list me hai." });
                return;
            }

            await reply({ title: "Added To Favorites", description: track.uri ? `[${track.title}](${track.uri})` : (track.title || "Track") });
            return;
        }

        if (sub === "addqueue" || sub === "queueadd") {
            const queueTracks = getQueueTracks(bot, message.guild.id);
            if (!queueTracks.length) {
                await reply({ title: "Queue Empty", description: "Queue me koi song nahi hai." });
                return;
            }

            let added = 0;
            let duplicate = 0;
            for (const t of queueTracks) {
                const result = await addFavorite(message.author.id, {
                    query: t.uri || t.title,
                    title: t.title,
                    uri: t.uri,
                    author: t.author,
                    sourceName: t.sourceName,
                    length: t.length
                }).catch(() => ({ added: false, duplicate: false }));

                if (result?.duplicate) duplicate += 1;
                else if (result?.added) added += 1;
            }

            await reply({
                title: "Queue Saved To Favorites",
                description: "Queue tracks processed.",
                fields: [
                    { name: "Added", value: String(added) },
                    { name: "Already Exists", value: String(duplicate) }
                ]
            });
            return;
        }

        if (sub === "list") {
            const items = await listFavorites(message.author.id);
            if (!items.length) {
                await reply({ title: "Favorites Empty", description: "Use `favorite add` to save songs." });
                return;
            }

            let out = "";
            for (let i = 0; i < items.length; i += 1) {
                const line = `${toLine(items[i], i + 1)}\n`;
                if ((out + line).length > MAX_LIST_TEXT) break;
                out += line;
            }

            await reply({ title: "Your Favorites", description: out.trim(), footer: `${items.length} total` });
            return;
        }

        if (sub === "play") {
            const second = String(args[1] || "").toLowerCase();
            const play = bot.commandMap.get("play");
            if (!play) {
                await reply({ title: "Unavailable", description: "Play command not loaded." });
                return;
            }

            if (second === "all") {
                const items = await listFavorites(message.author.id);
                if (!items.length) {
                    await reply({ title: "Favorites Empty", description: "Koi favorite song saved nahi hai." });
                    return;
                }

                const voice = message.member?.voice?.channel;
                if (!voice) {
                    await reply({ title: "Voice Channel Required", description: "Play all ke liye pehle voice channel join karo." });
                    return;
                }

                let queued = 0;
                for (let i = 0; i < items.length; i += 1) {
                    const resolved = await resolveFavoriteTrack(bot, message.guild.id, items[i]);
                    if (!resolved) continue;

                    if (i === 0) {
                        const firstQuery = resolved.uri || `${resolved.title} ${resolved.author}`;
                        await play.execute({ bot, message, args: [firstQuery], reply, prefix: "" });
                        queued += 1;
                        continue;
                    }

                    resolved.requester = message.author.tag;
                    resolved.requesterId = message.author.id;
                    bot.music.enqueue(message.guild.id, [resolved]);
                    queued += 1;
                }

                await bot.music.playIfIdle(message.guild.id).catch(() => null);
                await reply({ title: "Favorites Queued", description: `Queued ${queued} favorite tracks in order.` });
                return;
            }

            const index = Number(args[1]);
            if (!Number.isFinite(index) || index < 1) {
                await reply({ title: "Invalid Index", description: "Usage: `favorite play <index>` or `favorite play all`" });
                return;
            }

            const found = await getFavoriteByIndex(message.author.id, index);
            if (!found?.item) {
                await reply({ title: "Not Found", description: "Favorite index invalid." });
                return;
            }

            const query = found.item.uri || found.item.query || found.item.title;
            await play.execute({ bot, message, args: [query], reply, prefix: "" });
            return;
        }

        if (sub === "remove" || sub === "delete") {
            const index = Number(args[1]);
            if (!Number.isFinite(index) || index < 1) {
                await reply({ title: "Invalid Index", description: "Usage: `favorite remove <index>`" });
                return;
            }

            const result = await removeFavoriteByIndex(message.author.id, index);
            if (!result.removed) {
                await reply({ title: "Not Found", description: "Favorite index invalid." });
                return;
            }

            await reply({ title: "Favorite Removed", description: `Removed: ${result.item.title || result.item.query || "Track"}` });
            return;
        }

        await reply({
            title: "Favorite Help",
            description: "Use: `favorite add`, `favorite addqueue`, `favorite list`, `favorite play <index>`, `favorite play all`, `favorite remove <index>`"
        });
    }
};


