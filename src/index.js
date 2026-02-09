require("dotenv").config();
const { HimaBot } = require("./bot");

(async () => {
    const bot = new HimaBot();
    await bot.start();
})();
