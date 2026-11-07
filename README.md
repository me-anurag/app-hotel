# Sitebox

An installable PWA that holds your websites, running free on **Cloudflare Workers** (D1 database + KV storage, no card needed). You add a site with the **Upload** button (HTML file, several files, a folder, or a .zip) or **push it from VS Code** with one command, like `git push`. Every push is kept as a version you can roll back to, and every site is cached on your devices so the library works offline.

The first site in the box is **Builder's Quest** (`sites/builders-quest/`), the original `builders-quest.html` split into modules.

## Live instance

- **App:** https://sitebox.i-anurag.workers.dev (install it from the browser on phone or computer)
- **Token:** kept in your password manager. The `sitebox` CLI on this PC is already logged in (`~/.sitebox.json`).

## Deploy your own (free plan)

```bash
npm install
npx wrangler login
npx wrangler d1 create sitebox                # put the printed database_id in wrangler.toml
npx wrangler kv namespace create sitebox      # put the printed id in wrangler.toml
npx wrangler d1 migrations apply sitebox --remote
npx wrangler deploy                           # prints https://sitebox.<you>.workers.dev
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # your token
npx wrangler secret put SITEBOX_TOKEN         # paste it

npm link                                      # puts `sitebox` on your PATH
sitebox login https://sitebox.<you>.workers.dev <token>
npm run seed                                  # uploads sites/builders-quest
```

**Updating Sitebox itself** (the app or the Worker): `npm run deploy`. Your sites are not touched. A new file in `migrations/` needs `npx wrangler d1 migrations apply sitebox --remote` first.

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
npx wrangler d1 migrations apply sitebox --local   # once
npm run dev          # http://localhost:8787, with local D1/KV on disk (.wrangler/)
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
  index.js (routes) · sites.js (upload, versions) · serve.js (/s/ serving) · db.js (D1/KV helpers) · auth.js · util.js
migrations/            D1 database schema
cli/sitebox.js         the push CLI
lib/                   zip reader/writer + file helpers used by the CLI
sites/builders-quest/  Builder's Quest source (push with `npm run push:quest`)
  css/  tokens · base · scene · header · quest · dialog · responsive
  js/   main · state · storage · quest · picker · theme · scene · data/levels · data/types
wrangler.toml          Worker, D1, KV and settings
```

## How it works

- **Index (D1):** tables for sites, versions, and which content each file path points to.
- **Contents (KV):** stored once per unique SHA-256 (`b/<hash>`), shared across files, versions and sites. Unchanged files are never re-uploaded or re-stored, so a push usually writes only what you edited.
- **Uploads:** the client declares every file with its hash. The server replies with the hashes it's missing, the client sends just those, then commits. A version only goes live once everything has arrived. The Worker never unzips (the CLI and the app do), so each request fits the free plan's CPU limit.
- **Cleanup:** history is trimmed to `MAX_VERSIONS`. A daily job removes unfinished uploads and contents nothing uses any more.
- **Free plan limits that matter:** 1 GB of KV storage, 1,000 KV writes a day (one per *new* file content), 25 MB per file.
- **Single-file shortcut:** `curl -X PUT -H "Authorization: Bearer <token>" --data-binary @page.html <url>/api/sites/my-page`

## Settings (`wrangler.toml` → `[vars]`)

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_READ` | `"false"` | `"true"` = anyone with a link can view |
| `MAX_VERSIONS` | `"10"` | versions kept per site |
| `MAX_UPLOAD_MB` | `"200"` | total size of one push |
| `MAX_FILE_MB` | `"25"` | largest single file (KV's limit) |
| `SITEBOX_TOKEN` | secret | set with `npx wrangler secret put SITEBOX_TOKEN` |
