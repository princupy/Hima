const fs = require("node:fs");
const path = require("node:path");

function collectJsFiles(rootDir) {
    if (!fs.existsSync(rootDir)) return [];

    const out = [];
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const full = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectJsFiles(full));
            continue;
        }

        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".js")) continue;
        if (entry.name === "index.js") continue;

        out.push(full);
    }

    return out;
}

function isCommandModule(mod) {
    return Boolean(
        mod &&
        typeof mod === "object" &&
        typeof mod.name === "string" &&
        mod.name.trim().length > 0 &&
        typeof mod.execute === "function"
    );
}

function loadCommands() {
    const commandsDir = __dirname;
    const utilityDir = path.resolve(__dirname, "..", "utility");
    const settingsDir = path.resolve(__dirname, "..", "settings");
    const premiumDir = path.resolve(__dirname, "..", "premium");
    const spotifyDir = path.resolve(__dirname, "..", "spotify");
    const playlistsDir = path.resolve(__dirname, "..", "playlists");
    const favoritesDir = path.resolve(__dirname, "..", "favorites");
    const generalDir = path.resolve(__dirname, "..", "general");

    const files = [
        ...collectJsFiles(commandsDir),
        ...collectJsFiles(utilityDir),
        ...collectJsFiles(settingsDir),
        ...collectJsFiles(premiumDir),
        ...collectJsFiles(spotifyDir),
        ...collectJsFiles(playlistsDir),
        ...collectJsFiles(favoritesDir),
        ...collectJsFiles(generalDir)
    ];

    return files
        .map((file) => require(file))
        .filter(isCommandModule);
}

module.exports = { loadCommands };
