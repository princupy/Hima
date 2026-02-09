class SpotifyService {
    constructor({ clientId, clientSecret }) {
        this.clientId = (clientId || "").trim();
        this.clientSecret = (clientSecret || "").trim();
        this.accessToken = null;
        this.expiresAt = 0;
    }

    isSpotifyUrl(input) {
        return /^https?:\/\/open\.spotify\.com\/(track|playlist)\//i.test(input);
    }

    async getAccessToken() {
        const now = Date.now();
        if (this.accessToken && now < this.expiresAt - 30_000) return this.accessToken;

        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
        const res = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "grant_type=client_credentials"
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Spotify token request failed (${res.status}) ${body}`.trim());
        }

        const data = await res.json();
        this.accessToken = data.access_token;
        this.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
        return this.accessToken;
    }

    parseUrl(url) {
        const match = url.match(/open\.spotify\.com\/(track|playlist)\/([A-Za-z0-9]+)/i);
        if (!match) return null;
        return { type: match[1].toLowerCase(), id: match[2] };
    }

    async spotifyGet(path) {
        const token = await this.getAccessToken();
        const res = await fetch(`https://api.spotify.com/v1${path}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (res.status === 401) {
            this.accessToken = null;
            const retry = await this.getAccessToken();
            const retryRes = await fetch(`https://api.spotify.com/v1${path}`, {
                headers: { Authorization: `Bearer ${retry}` }
            });
            if (!retryRes.ok) throw new Error(`Spotify request failed (${retryRes.status})`);
            return retryRes.json();
        }

        if (!res.ok) throw new Error(`Spotify request failed (${res.status})`);
        return res.json();
    }

    toSearchQuery(trackName, artists) {
        return `ytsearch:${trackName} ${artists.join(" ")}`.trim();
    }

    async resolveToSearchQueries(url) {
        const parsed = this.parseUrl(url);
        if (!parsed) throw new Error("Invalid Spotify URL");

        if (parsed.type === "track") {
            const track = await this.spotifyGet(`/tracks/${parsed.id}`);
            const query = this.toSearchQuery(
                track.name,
                (track.artists || []).map((a) => a.name)
            );
            return [query];
        }

        if (parsed.type === "playlist") {
            const queries = [];
            let next = `/playlists/${parsed.id}/tracks?limit=100`;

            while (next) {
                const pagePath = next.replace("https://api.spotify.com/v1", "");
                const data = await this.spotifyGet(pagePath);

                for (const item of data.items || []) {
                    const t = item.track;
                    if (!t || !t.name) continue;
                    queries.push(
                        this.toSearchQuery(
                            t.name,
                            (t.artists || []).map((a) => a.name)
                        )
                    );
                }

                next = data.next;
                if (queries.length >= 300) break;
            }

            return queries;
        }

        throw new Error("Unsupported Spotify URL type");
    }
}

module.exports = { SpotifyService };

