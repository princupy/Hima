# Hima Website

This folder contains the standalone multi-page website for the Hima Discord bot.

## Pages

- `index.html` - Landing page and system overview
- `features.html` - Full feature architecture
- `commands.html` - Searchable command explorer (JSON-driven)
- `premium.html` - Premium model and pricing page
- `contact.html` - Deploy/support page

## Assets

- `assets/css/` - Shared + page specific styles
- `assets/js/` - UI interactions and command explorer logic
- `assets/data/commands.json` - Command catalog source

## Run Locally

> Do not open HTML via `file://` directly, because `commands.html` loads JSON with `fetch`.

### Option A (Node.js, recommended)

From project root:

```bash
npx serve website -l 8080
```

Then open: `http://localhost:8080`

### Option B (Node.js alternate)

```bash
npx http-server website -p 8080 -c-1
```

### Option C (Python, only if installed)

```bash
cd website
python -m http.server 8080
```

## Deploy

You can deploy this folder directly on:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel (static)
- VPS (Nginx/Apache)

Use `website` as the publish root.
