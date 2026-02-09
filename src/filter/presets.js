const PRESETS = {
    off: {
        name: "off",
        label: "Off",
        description: "Disable all active filters.",
        filters: {
            equalizer: [],
            karaoke: null,
            timescale: null,
            tremolo: null,
            vibrato: null,
            rotation: null,
            distortion: null,
            channelMix: null,
            lowPass: null
        }
    },
    bassboost: {
        name: "bassboost",
        label: "Bass Boost",
        description: "Punchy bass with mild mids cut.",
        filters: {
            equalizer: [
                { band: 0, gain: 0.22 },
                { band: 1, gain: 0.2 },
                { band: 2, gain: 0.17 },
                { band: 3, gain: 0.1 },
                { band: 4, gain: 0.04 },
                { band: 5, gain: 0.02 }
            ]
        }
    },
    vaporwave: {
        name: "vaporwave",
        label: "Vaporwave",
        description: "Slower, dreamy and detuned.",
        filters: {
            timescale: { speed: 0.88, pitch: 0.88, rate: 1.0 },
            equalizer: [
                { band: 1, gain: 0.08 },
                { band: 2, gain: 0.12 },
                { band: 5, gain: -0.06 }
            ]
        }
    },
    nightcore: {
        name: "nightcore",
        label: "Nightcore",
        description: "Faster and higher pitch.",
        filters: {
            timescale: { speed: 1.2, pitch: 1.2, rate: 1.0 }
        }
    },
    soft: {
        name: "soft",
        label: "Soft",
        description: "Warm and smooth sound.",
        filters: {
            lowPass: { smoothing: 18.0 },
            equalizer: [
                { band: 0, gain: -0.03 },
                { band: 1, gain: 0.03 },
                { band: 2, gain: 0.06 },
                { band: 5, gain: -0.04 },
                { band: 6, gain: -0.05 }
            ]
        }
    },
    karaoke: {
        name: "karaoke",
        label: "Karaoke",
        description: "Center vocal reduction.",
        filters: {
            karaoke: {
                level: 1.0,
                monoLevel: 1.0,
                filterBand: 220,
                filterWidth: 100
            }
        }
    },
    treble: {
        name: "treble",
        label: "Treble Boost",
        description: "Sharper highs.",
        filters: {
            equalizer: [
                { band: 7, gain: 0.08 },
                { band: 8, gain: 0.12 },
                { band: 9, gain: 0.14 },
                { band: 10, gain: 0.16 },
                { band: 11, gain: 0.12 },
                { band: 12, gain: 0.08 }
            ]
        }
    },
    "8d": {
        name: "8d",
        label: "8D Audio",
        description: "Headphone-style circular motion.",
        filters: {
            rotation: { rotationHz: 0.2 }
        }
    },
    tremolo: {
        name: "tremolo",
        label: "Tremolo",
        description: "Volume wobble effect.",
        filters: {
            tremolo: { frequency: 4.0, depth: 0.75 }
        }
    },
    vibrato: {
        name: "vibrato",
        label: "Vibrato",
        description: "Pitch wobble effect.",
        filters: {
            vibrato: { frequency: 5.0, depth: 0.6 }
        }
    },
    chipmunk: {
        name: "chipmunk",
        label: "Chipmunk",
        description: "Very high pitch voice.",
        filters: {
            timescale: { speed: 1.0, pitch: 1.35, rate: 1.0 }
        }
    },
    slowed: {
        name: "slowed",
        label: "Slowed + Reverb-ish",
        description: "Relaxed slow playback feel.",
        filters: {
            timescale: { speed: 0.92, pitch: 0.96, rate: 1.0 },
            lowPass: { smoothing: 14.0 }
        }
    },
    distorted: {
        name: "distorted",
        label: "Distorted",
        description: "Heavy rough effect.",
        filters: {
            distortion: {
                sinOffset: 0,
                sinScale: 1,
                cosOffset: 0,
                cosScale: 1,
                tanOffset: 0,
                tanScale: 0.3,
                offset: 0,
                scale: 1
            }
        }
    },
    earrape: {
        name: "earrape",
        label: "Earrape",
        description: "Very loud and aggressive EQ.",
        filters: {
            equalizer: [
                { band: 0, gain: 0.25 },
                { band: 1, gain: 0.25 },
                { band: 2, gain: 0.2 },
                { band: 3, gain: 0.18 },
                { band: 4, gain: 0.14 },
                { band: 5, gain: 0.1 }
            ]
        }
    },
    radio: {
        name: "radio",
        label: "Radio",
        description: "Telephone/radio style narrow band.",
        filters: {
            equalizer: [
                { band: 0, gain: -0.2 },
                { band: 1, gain: -0.15 },
                { band: 2, gain: 0.1 },
                { band: 3, gain: 0.12 },
                { band: 4, gain: 0.1 },
                { band: 5, gain: -0.05 },
                { band: 6, gain: -0.15 }
            ],
            lowPass: { smoothing: 8.0 }
        }
    }
};

function normalizeFilterName(input) {
    return String(input || "").trim().toLowerCase();
}

function getFilterPreset(inputName) {
    const name = normalizeFilterName(inputName);
    if (!name) return null;
    return PRESETS[name] || null;
}

function listFilterPresets() {
    return Object.values(PRESETS);
}

function listFilterNames() {
    return listFilterPresets().map((x) => x.name);
}

module.exports = {
    PRESETS,
    normalizeFilterName,
    getFilterPreset,
    listFilterPresets,
    listFilterNames
};


