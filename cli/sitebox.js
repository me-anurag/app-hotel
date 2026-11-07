#!/usr/bin/env node
/* sitebox: push sites to your Sitebox from the terminal / VS Code, git-style.

   sitebox login <server> <token>     remember your Sitebox address and token
   sitebox init [name]                create sitebox.json in this folder
   sitebox push [path] [-n name] [-m message] [-t title]
   sitebox watch [path]               push automatically on every save
   sitebox list | open <name> | pull <name> [dir] | rm <name> | log <name> | rollback <name> <version>
*/
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { readZip } = require("../lib/zip");
const { readDir } = require("../lib/files");

const GLOBAL_CFG = path.join(os.homedir(), ".sitebox.json");
const PROJECT_CFG = "sitebox.json";

/* ---------- config ---------- */

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };

function findProjectConfig(start = process.cwd()) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const f = path.join(dir, PROJECT_CFG);
    if (fs.existsSync(f)) return { file: f, dir, ...readJson(f) };
    if (path.dirname(dir) === dir) return null;
  }
}

function settings(flags) {
  const g = readJson(GLOBAL_CFG), p = findProjectConfig() || {};
  return {
    server: (flags.server || process.env.SITEBOX_SERVER || p.server || g.server || "http://localhost:8787").replace(/\/+$/, ""),
    token: flags.token || process.env.SITEBOX_TOKEN || g.token || "",
    project: p,
  };
}

/* ---------- args ---------- */

function parseArgs(argv) {
  const alias = { n: "name", m: "message", t: "title", s: "server", h: "help" };
  const flags = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] || a.replace(/^-+/, "");
      const next = argv[i + 1];
      if (key === "help" || key === "open" || next === undefined || next.startsWith("-")) flags[key] = true;
      else { flags[key] = next; i++; }
    } else pos.push(a);
  }
  return { cmd: pos[0], args: pos.slice(1), flags };
}

/* ---------- http ---------- */

async function api(cfg, method, route, body, headers = {}) {
  const res = await fetch(cfg.server + route, {
    method, body,
    headers: { ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}), ...headers },
  }).catch((e) => { throw new Error(`Can't reach ${cfg.server} (${e.cause?.code || e.message}). Check the address, or run "npm run dev" for a local Sitebox.`); });
  if (res.status === 401) throw new Error(`Unauthorised. Run: sitebox login ${cfg.server} <token>`);
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------- helpers ---------- */

const slugify = (s) => String(s).toLowerCase().replace(/\.(html?|zip)$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
const fmtBytes = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m` };

function openUrl(url) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(cmd, args, () => {});
}

/** Figure out what to push and under which name. */
function resolveTarget(cfg, args, flags) {
  let proj = cfg.project;
  let target;
  if (args[0]) {
    target = path.resolve(args[0]);
    if (!fs.existsSync(target)) throw new Error(`Not found: ${target}`);
    // A folder inside a project with sitebox.json pushes as that project;
    // a single file is always its own site (so it can't replace a whole project by accident).
    const isDir = fs.statSync(target).isDirectory();
    const own = isDir ? findProjectConfig(target) : null;
    proj = own || {};
    if (own && path.resolve(own.dir) === target && own.path) target = path.resolve(own.dir, own.path);
  } else {
    target = path.resolve(proj.dir || process.cwd(), proj.path || ".");
  }
  if (!fs.existsSync(target)) throw new Error(`Not found: ${target}`);
  // "my-site/index.html" is named after its folder, "about.html" after the file.
  const fromPath = /^index\.html?$/i.test(path.basename(target)) ? path.basename(path.dirname(target)) : path.basename(target);
  const name = slugify(flags.name || proj.name || fromPath || "site");
  if (!name) throw new Error("Couldn't work out a site name. Pass one with --name");
  return { target, name };
}

/** Read what to push into [{ path, data }]. Zips are unpacked here, not on the server. */
function collect(target) {
  let files;
  if (fs.statSync(target).isDirectory()) files = readDir(target);
  else if (/\.zip$/i.test(target)) files = readZip(fs.readFileSync(target));
  else if (/\.html?$/i.test(target)) files = [{ path: path.basename(target), data: fs.readFileSync(target) }];
  else throw new Error("Push a folder, an .html file, or a .zip");
  if (!files.some((f) => /\.html?$/i.test(f.path))) throw new Error(`No .html file in ${target}`);
  return files;
}

/** Upload protocol: declare the files -> send each one (6 at a time) -> commit. */
async function upload(cfg, slug, files, meta, onProgress = () => {}) {
  const begin = await api(cfg, "POST", `/api/sites/${slug}/uploads`,
    JSON.stringify({ files: files.map((f) => ({ path: f.path, size: f.data.length })), ...meta }),
    { "Content-Type": "application/json" });
  const jobs = files.map((f, i) => ({ data: f.data, path: begin.paths[i] })).filter((j) => j.path);
  let done = 0, next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const route = `/api/sites/${slug}/uploads/${begin.version}/${j.path.split("/").map(encodeURIComponent).join("/")}`;
      await api(cfg, "PUT", route, j.data, { "Content-Type": "application/octet-stream" });
      onProgress(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, lane));
  return api(cfg, "POST", `/api/sites/${slug}/uploads/${begin.version}/commit`);
}

/* ---------- commands ---------- */

const commands = {
  async login(cfg, [server, token]) {
    if (!server) throw new Error("Usage: sitebox login <server-url> <token>");
    const g = readJson(GLOBAL_CFG);
    g.server = server.replace(/\/+$/, "");
    if (token) g.token = token;
    fs.writeFileSync(GLOBAL_CFG, JSON.stringify(g, null, 2));
    const ping = await api({ server: g.server, token: g.token || "" }, "GET", "/api/ping");
    if (!ping.authed) throw new Error(`Saved ${g.server}, but the token was not accepted. Check it and run login again.`);
    console.log(c.green("✓"), `Logged in to ${g.server}`);
  },

  async init(cfg, [name], flags) {
    if (fs.existsSync(PROJECT_CFG)) throw new Error(`${PROJECT_CFG} already exists here`);
    const conf = { name: slugify(name || flags.name || path.basename(process.cwd())), path: flags.path || "." };
    if (flags.server) conf.server = flags.server;
    fs.writeFileSync(PROJECT_CFG, JSON.stringify(conf, null, 2) + "\n");
    console.log(c.green("✓"), `Created ${PROJECT_CFG} → site "${conf.name}". Now run: sitebox push`);
  },

  async push(cfg, args, flags) {
    const { target, name } = resolveTarget(cfg, args, flags);
    const files = collect(target);
    const t0 = Date.now();
    const tty = process.stdout.isTTY && files.length > 3;
    const site = await upload(cfg, name, files, {
      source: flags.source || "cli",
      message: typeof flags.message === "string" ? flags.message : "",
      title: typeof flags.title === "string" ? flags.title : "",
    }, (d, n) => tty && process.stdout.write(`\r  uploading ${d}/${n}`));
    if (tty) process.stdout.write("\r\x1b[K");
    const url = cfg.server + site.url;
    console.log(c.green("✓"), `Pushed ${c.bold(name)} v${site.current}`, c.dim(`· ${site.files} file${site.files === 1 ? "" : "s"} · ${fmtBytes(site.bytes)} · ${Date.now() - t0} ms`));
    console.log("  ", url);
    if (flags.open) openUrl(url);
    return site;
  },

  async watch(cfg, args, flags) {
    const { target, name } = resolveTarget(cfg, args, flags);
    if (!fs.statSync(target).isDirectory()) throw new Error("watch needs a folder");
    console.log(c.dim(`Watching ${target} → ${name}. Ctrl+C to stop.`));
    let timer = null, busy = false, again = false;
    const run = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try { await commands.push(cfg, [target], { ...flags, name, source: "watch", open: false }); }
      catch (e) { console.error(c.red("✗"), e.message); }
      busy = false;
      if (again) { again = false; run(); }
    };
    await run();
    fs.watch(target, { recursive: true }, (_evt, file) => {
      if (file && /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(run, 400);
    });
    return new Promise(() => {});
  },

  async list(cfg) {
    const { sites } = await api(cfg, "GET", "/api/sites");
    if (!sites.length) return console.log(c.dim("No sites yet. Push one with: sitebox push"));
    const w = Math.max(...sites.map((s) => s.slug.length));
    for (const s of sites) {
      console.log(`${c.bold(s.slug.padEnd(w))}  v${String(s.current).padEnd(3)} ${c.dim(fmtBytes(s.bytes).padStart(9))}  ${s.title}`);
    }
  },

  async log(cfg, [name]) {
    if (!name) throw new Error("Usage: sitebox log <name>");
    const site = await api(cfg, "GET", `/api/sites/${name}`);
    for (const v of site.versions) {
      const mark = v.id === site.current ? c.green("●") : " ";
      console.log(`${mark} v${v.id}  ${new Date(v.createdAt).toLocaleString()}  ${c.dim(v.source)}  ${v.message || ""}`);
    }
  },

  async rollback(cfg, [name, version]) {
    if (!name || !version) throw new Error("Usage: sitebox rollback <name> <version>");
    const site = await api(cfg, "POST", `/api/sites/${name}/rollback`, JSON.stringify({ version: Number(version.replace(/^v/, "")) }), { "Content-Type": "application/json" });
    console.log(c.green("✓"), `${name} is now on v${site.current}`);
  },

  async open(cfg, [name], flags) {
    const slug = name || resolveTarget(cfg, [], flags).name;
    const url = `${cfg.server}/#/view/${slug}`;
    console.log(url);
    openUrl(url);
  },

  async pull(cfg, [name, dir]) {
    if (!name) throw new Error("Usage: sitebox pull <name> [dir]");
    const out = path.resolve(dir || name);
    if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} is not empty`);
    const files = (await api(cfg, "GET", `/api/sites/${name}`)).fileList;
    for (const p of files) {
      const res = await fetch(`${cfg.server}/s/${name}/${p.split("/").map(encodeURIComponent).join("/")}`,
        { headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {} });
      if (!res.ok) throw new Error(`Couldn't download ${p} (HTTP ${res.status})`);
      const dest = path.join(out, ...p.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    }
    fs.writeFileSync(path.join(out, PROJECT_CFG), JSON.stringify({ name, path: "." }, null, 2) + "\n");
    console.log(c.green("✓"), `Pulled ${files.length} files into ${out}`);
  },

  async rm(cfg, [name]) {
    if (!name) throw new Error("Usage: sitebox rm <name>");
    await api(cfg, "DELETE", `/api/sites/${name}`);
    console.log(c.green("✓"), `Deleted ${name}`);
  },
};

function help() {
  console.log(`
${c.bold("sitebox")} — push sites to your Sitebox PWA

  sitebox push [path] [-n name] [-m "message"] [-t title] [--open]
        Push a folder, .html file or .zip. Defaults come from sitebox.json.
  sitebox watch [path]          Re-push on every save
  sitebox init [name]           Create sitebox.json for this folder
  sitebox login <url> <token>   Set your Sitebox address and token
  sitebox list                  List sites
  sitebox log <name>            Version history
  sitebox rollback <name> <v>   Make an older version live
  sitebox open [name]           Open the site in the browser
  sitebox pull <name> [dir]     Download a site's files
  sitebox rm <name>             Delete a site

  Options: --server <url>  --token <token>   (or SITEBOX_SERVER / SITEBOX_TOKEN)
`);
}

(async () => {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2));
  if (!cmd || flags.help || !commands[cmd]) return help();
  try { await commands[cmd](settings(flags), args, flags); }
  catch (e) { console.error(c.red("✗"), e.message); process.exitCode = 1; }
})();
