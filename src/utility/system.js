const os = require("node:os");
const { buildUtilityPayload } = require("./card");

module.exports = {
    name: "system",
    aliases: ["sys"],
    description: "Show host system metrics.",
    usage: "system",
    async execute({ bot, message }) {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        const usedMb = Math.round(used / 1024 / 1024);
        const totalMb = Math.round(total / 1024 / 1024);

        await message.reply(buildUtilityPayload({
            bot,
            title: "System",
            summary: "Host machine and runtime health.",
            details: [
                `**Platform:** ${os.platform()} (${os.arch()})`,
                `**CPU Cores:** ${os.cpus().length}`,
                `**Load Avg:** ${os.loadavg().map((x) => x.toFixed(2)).join(" / ")}`,
                `**Memory:** ${usedMb} MB / ${totalMb} MB`,
                `**Node:** ${process.version}`,
                `**Process Uptime:** ${Math.floor(process.uptime())} sec`
            ],
            footer: "Hima System Monitor"
        }));
    }
};
