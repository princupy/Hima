const { MessageFlags } = require("discord.js");
const { voteUrl, buyUrl } = require("./service");
const { listExpiredVoteUsersForNotify, markVoteExpiryNotified } = require("./profile");

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const CHECK_INTERVAL_MS = Math.max(60_000, Number(process.env.VOTE_EXPIRY_CHECK_MS || 300_000));
const BATCH_LIMIT = Math.max(10, Number(process.env.VOTE_EXPIRY_BATCH_LIMIT || 100));

function buildExpiryDm(bot, voteUntil) {
    const unix = voteUntil ? Math.floor(new Date(voteUntil).getTime() / 1000) : null;
    return {
        flags: COMPONENTS_V2_FLAG,
        components: [
            {
                type: 17,
                components: [
                    { type: 10, content: "## Vote Premium Expired" },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: "Your vote premium has expired. Vote again to reactivate your premium features instantly." },
                    ...(unix ? [{ type: 10, content: `Expired at: <t:${unix}:F>` }] : []),
                    {
                        type: 1,
                        components: [
                            { type: 2, style: 5, label: "Vote Now", url: voteUrl(bot) },
                            { type: 2, style: 5, label: "Buy Premium", url: buyUrl() }
                        ]
                    },
                    { type: 10, content: "After voting, run `vote` command to sync immediately." }
                ]
            }
        ]
    };
}

async function notifyOne(bot, row) {
    try {
        const user = await bot.client.users.fetch(row.user_id).catch(() => null);
        if (user) {
            await user.send(buildExpiryDm(bot, row.vote_until)).catch(() => null);
        }
    } finally {
        await markVoteExpiryNotified(row.user_id, row.vote_until).catch(() => null);
    }
}

async function runVoteExpirySweep(bot) {
    const rows = await listExpiredVoteUsersForNotify(BATCH_LIMIT).catch(() => []);
    if (!rows.length) return;

    for (const row of rows) {
        await notifyOne(bot, row);
    }
}

function startVoteExpiryReminderLoop(bot) {
    const run = async () => {
        await runVoteExpirySweep(bot).catch((error) => {
            console.error("[Vote Expiry Reminder Error]", error?.message || error);
        });
    };

    run();
    const timer = setInterval(run, CHECK_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
}

module.exports = {
    startVoteExpiryReminderLoop,
    runVoteExpirySweep
};
