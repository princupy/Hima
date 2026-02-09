let cachedModulePromise = null;
let fontsInitPromise = null;

const DEFAULT_FALLBACK_ART = "https://cdn.discordapp.com/embed/avatars/0.png";

function getModule() {
    if (!cachedModulePromise) {
        cachedModulePromise = import("musicard");
    }
    return cachedModulePromise;
}

async function ensureFonts(mod) {
    if (!fontsInitPromise) {
        fontsInitPromise = Promise.resolve(mod.initializeFonts());
    }
    return fontsInitPromise;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function progressPercent(positionMs, lengthMs) {
    if (!Number.isFinite(lengthMs) || lengthMs <= 0) return 0;
    const ratio = (Number(positionMs) || 0) / lengthMs;
    return clamp(Math.round(ratio * 100), 0, 100);
}

function isExplicitTrack(track) {
    const title = String(track?.title || "").toLowerCase();
    return title.includes("explicit");
}

async function upscaleCard(buffer, scale = 1.18) {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(buffer);

    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, width, height);

    return canvas.toBuffer("image/png");
}

async function applyCardVariant(buffer, variant) {
    const name = String(variant || "ease").toLowerCase();
    if (name === "ease" || name === "glass") return buffer;

    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(buffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, image.width, image.height);

    if (name === "neon") {
        ctx.fillStyle = "rgba(155, 0, 255, 0.20)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(0, 255, 180, 0.10)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (name === "sunset") {
        ctx.fillStyle = "rgba(255, 120, 20, 0.20)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(255, 20, 120, 0.10)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (name === "ocean") {
        ctx.fillStyle = "rgba(0, 120, 255, 0.20)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(0, 220, 255, 0.10)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (name === "mono") {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3);
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
    }

    return canvas.toBuffer("image/png");
}

async function renderEaseCard({ track, positionMs, volume }) {
    const mod = await getModule();
    await ensureFonts(mod);

    const base = await mod.Ease({
        trackName: track?.title || "Unknown Track",
        artistName: track?.author || "Unknown Artist",
        albumArt: track?.artworkUrl || DEFAULT_FALLBACK_ART,
        fallbackArt: DEFAULT_FALLBACK_ART,
        isExplicit: isExplicitTrack(track),
        timeAdjust: {
            timeStart: msToClock(positionMs || 0),
            timeEnd: msToClock(track?.length || 0)
        },
        progressBar: progressPercent(positionMs || 0, track?.length || 0),
        volumeBar: clamp(Number(volume || 100), 0, 100)
    });

    const scale = Number(process.env.MUSICARD_SCALE || 1.28);
    if (!Number.isFinite(scale) || scale <= 1) return base;

    try {
        return await upscaleCard(base, Math.min(scale, 1.8));
    } catch {
        return base;
    }
}

async function renderThemedCard({ track, positionMs, volume, theme }) {
    const base = await renderEaseCard({ track, positionMs, volume });
    try {
        return await applyCardVariant(base, theme || "ease");
    } catch {
        return base;
    }
}

function msToClock(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "0:00";
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

module.exports = {
    renderEaseCard,
    renderThemedCard,
    msToClock
};
