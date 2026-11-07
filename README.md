# Sitebox

An installable PWA that holds your websites, running on **Cloudflare Workers + R2**. You add a site with the **Upload** button (HTML file, several files, a folder, or a .zip) or **push it from VS Code** with one command, like `git push`. Every push is kept as a version you can roll back to, and every site is cached on your devices so the library works offline.

The first site in the box is **Builder's Quest** (`sites/builders-quest/`), the original `builders-quest.html` split into modules.

## Deploy to Cloudflare (one time, ~10 minutes)

You need a free Cloudflare account. R2 may ask you to add a payment method before you can enable it, but personal use stays within the free tier (10 GB of storage).

```bash
npm install                                   # installs wrangler (Cloudflare's CLI)
npx wrangler login                            # opens the browser to authorise
npx wrangler r2 bucket create sitebox         # where your sites are stored
npx wrangler deploy                           # prints your URL: https://sitebox.<you>.workers.dev

# Make a long random token and save it somewhere safe (a password manager):
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
npx wrangler secret put SITEBOX_TOKEN         # paste the token when asked
```

Then connect the CLI and put Builder's Quest in the box:

```bash
npm link                                      # puts `sitebox` on your PATH
sitebox login https://sitebox.<you>.workers.dev <your-token>
npm run seed                                  # uploads sites/builders-quest
```

Open your URL on your phone or computer, enter the token once, and install it (Chrome/Edge: install icon in the address bar; iPhone Safari: Share → Add to Home Screen).

**Updating Sitebox itself** (the app or the Worker): `npm run deploy`. Your sites in R2 are not touched.

## Push from VS Code

```bash
cd path/to/your-site
sitebox init my-site                # writes sitebox.json
sitebox push -m "first version"     # live at <your-url>/s/my-site/
sitebox watch                       # re-push on every save
```

To push with one key, copy `.vscode/tasks.json` into your project and press **Ctrl+Shift+B**. Open copies of the app pick up pushes within a few seconds and reload the site you're viewing.

| Command | What it does |
|---|---|
| `sitebox push [path] [-n name] [-m msg] [-t title] [--open]` | Push a folder, an `.html` file or a `.zip` |
| `sitebox watch [path]` | Push on every save |
| `sitebox list` / `log <name>` | List sites / show version history |
| `sitebox rollback <name> <v>` | Make an older version live |
| `sitebox pull <name> [dir]` | Download a site's files |
| `sitebox open [name]` / `rm <name>` | Open in browser / delete |
| `sitebox login <url> <token>` | Set your Sitebox address and token |

## Run locally

```bash
npm run dev          # http://localhost:8787, with a local copy of R2 on disk (.wrangler/)
```

The local token is in `.dev.vars` (`dev-token`). The CLI talks to `http://localhost:8787` unless you've run `sitebox login`, or you set `SITEBOX_SERVER`/`SITEBOX_TOKEN`.

## Privacy

- By default **everything is private**: the library and every site need your token. The app keeps it on the device, so you enter it once per device.
- To make sites viewable by anyone with the link (for example to share a page), set `PUBLIC_READ = "true"` in `wrangler.toml` and run `npm run deploy`. Uploading, editing and deleting always need the token.
- All sites share one address, so they share browser storage (`localStorage`). Two sites that use the same storage keys will see each other's data. Treat stored sites as your own code.

## Project layout

```
app/                   PWA shell (static assets served by the Worker)
  index.html, manifest.webmanifest, sw.js, css/app.css, icons/
  js/  main (routing) · store · api · library · viewer · upload · details · pushhelp · offline · zip · ui
worker/src/            Cloudflare Worker
  index.js (routes) · sites.js (upload, versions) · serve.js (/s/ from R2) · db.js (site index) · auth.js · util.js
cli/sitebox.js         the push CLI
lib/                   zip reader/writer + file helpers used by the CLI
sites/builders-quest/  Builder's Quest source (push with `npm run push:quest`)
  css/  tokens · base · scene · header · quest · dialog · responsive
  js/   main · state · storage · quest · picker · theme · scene · data/levels · data/types
wrangler.toml          Worker, R2 bucket and settings
```

## How it works

- **Storage (R2):** `db.json` is the index of sites and versions. Files live at `f/<site>/<version>/<path>`, and each version has a file list at `m/<site>/<version>.json`. Old versions beyond `MAX_VERSIONS` (10) are deleted automatically.
- **Uploads** happen file by file: the client declares the files, sends each one, then commits. The Worker never unzips anything (the CLI and the app do), so each request stays well inside the free plan's CPU limit. A version only goes live once every file has arrived. A daily job clears out uploads that were started but never finished.
- **Single-file shortcut:** `curl -X PUT -H "Authorization: Bearer <token>" --data-binary @page.html <url>/api/sites/my-page`

## Settings (`wrangler.toml` → `[vars]`)

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_READ` | `"false"` | `"true"` = anyone with a link can view |
| `MAX_VERSIONS` | `"10"` | versions kept per site |
| `MAX_UPLOAD_MB` | `"200"` | total size of one push (each single file is also limited to 100 MB by Cloudflare) |
| `SITEBOX_TOKEN` | secret | set with `npx wrangler secret put SITEBOX_TOKEN` |
