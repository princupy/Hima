const { createClient } = require("@supabase/supabase-js");
const { loadConfig } = require("../config");

const cfg = loadConfig();

const supabase = createClient(cfg.supabase.url, cfg.supabase.key, {
    auth: { persistSession: false },
    global: {
        headers: {
            "x-application-name": "hima-bot"
        }
    }
});

module.exports = { supabase };
