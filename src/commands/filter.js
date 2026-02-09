const { listFilterPresets, getFilterPreset } = require("../filter");

function formatFilterList() {
    return listFilterPresets()
        .map((p) => `\`${p.name}\` - ${p.description}`)
        .join("\n");
}

module.exports = {
    name: "filter",
    aliases: ["fx", "filters"],
    description: "Apply Lavalink audio filters.",
    usage: "filter <list|off|name>",
    async execute({ bot, message, args, reply }) {
        const state = bot.music.get(message.guild.id);
        if (!state || !state.player) {
            await reply({
                title: "Not Connected",
                description: "No active player. Play a song first."
            });
            return;
        }

        const input = String(args[0] || "list").toLowerCase();

        if (input === "list") {
            const active = bot.music.getFilterStatus(message.guild.id);
            await reply({
                title: "Audio Filters",
                description: "Use `filter <name>` to apply in realtime.",
                fields: [
                    { name: "Available", value: formatFilterList() },
                    { name: "Current", value: active?.label || "Off" }
                ]
            });
            return;
        }

        if (input === "off" || input === "reset" || input === "clear") {
            const cleared = await bot.music.clearFilters(message.guild.id);
            if (!cleared) {
                await reply({
                    title: "Filter Error",
                    description: "Failed to clear filters."
                });
                return;
            }

            await reply({
                title: "Filter Off",
                description: "All filters disabled."
            });
            return;
        }

        const preset = getFilterPreset(input);
        if (!preset) {
            await reply({
                title: "Unknown Filter",
                description: "Invalid filter name.",
                fields: [{ name: "Try", value: "Use `filter list` to view all filters." }]
            });
            return;
        }

        const result = await bot.music.applyFilter(message.guild.id, preset.name);
        if (!result?.ok) {
            await reply({
                title: "Filter Error",
                description: result?.reason || "Could not apply this filter."
            });
            return;
        }

        await reply({
            title: "Filter Applied",
            description: `Now using **${result.label || preset.label}**.`,
            fields: [{ name: "Preset", value: `\`${result.name}\`` }]
        });
    }
};
