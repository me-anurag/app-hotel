/* Sitebox service worker.
   - App shell + API: network-first with a short timeout, cached fallback (works offline).
   - Hosted sites (/s/<slug>/...): network-first into a per-site cache; the app asks us to
     pre-cache every file of every site so the whole library opens offline.
   - Third-party assets used by sites (fonts, CDNs): stale-while-revalidate.
   - Share target: files shared to the installed app are stashed and handed to the upload dialog. */

const VERSION = "v3";
const SHELL = `sitebox-shell-${VERSION}`;
const API = "sitebox-api";
const CDN = "sitebox-cdn";
const META = "sitebox-meta";
const SHARE = "sitebox-share";
const siteCache = (slug) => `sitebox-site-${slug}`;

const SHELL_FILES = [
  "/", "/css/app.css", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png",
  "/js/main.js", "/js/ui.js", "/js/api.js", "/js/store.js", "/js/library.js", "/js/viewer.js",
  "/js/upload.js", "/js/details.js", "/js/pushhelp.js", "/js/zip.js", "/js/offline.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("sitebox-shell-") && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/* ---------- strategies ---------- */

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

async function networkFirst(req, cacheName, { key = req, ms = 3500 } = {}) {
  const cache = await caches.open(cacheName);
  const net = fetch(req).then((res) => {
    if (res.ok && res.type === "basic") cache.put(key, res.clone());
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, timeout(ms)]);
  } catch {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    return net.catch(() => offline());
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; });
  net.catch(() => {});
  return hit || net.catch(() => offline());
}

function offline() {
  return new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Offline</title>
     <body style="font:16px system-ui;padding:40px;text-align:center;color:#5d6a58"><h1 style="color:#1b2419">You're offline</h1>
     <p>This page hasn't been saved for offline use yet. Open Sitebox while connected to save it.</p>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* ---------- routing ---------- */

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname === "/share-target") return e.respondWith(receiveShare(req));
  if (req.method !== "GET") return;

  if (url.origin !== location.origin) {
    if (["style", "font", "script", "image"].includes(req.destination)) e.respondWith(staleWhileRevalidate(req, CDN));
    return;
  }
  if (url.pathname === "/api/ping" || url.pathname === "/api/session") return;   // must reflect the real connection

  if (url.pathname.startsWith("/s/")) {
    const slug = decodeURIComponent(url.pathname.split("/")[2] || "");
    const key = url.origin + url.pathname;   // ignore ?v= cache-busters
    return e.respondWith(networkFirst(req, siteCache(slug), { key }));
  }
  if (url.pathname.startsWith("/api/")) return e.respondWith(networkFirst(req, API));

  // App shell: every navigation outside /s/ is the single-page app.
  if (req.mode === "navigate") return e.respondWith(networkFirst(new Request("/"), SHELL, { key: "/" }));
  e.respondWith(networkFirst(req, SHELL));
});

/* ---------- offline sync of whole sites ---------- */

async function syncSites(sites) {
  const meta = await caches.open(META);
  const keep = new Set(sites.map((s) => siteCache(s.slug)));

  for (const key of await caches.keys()) {
    if (key.startsWith("sitebox-site-") && !keep.has(key)) {
      await caches.delete(key);
      await meta.delete(`/__sitebox/cached/${key.slice(13)}`);
    }
  }

  for (const s of sites) {
    const marker = `/__sitebox/cached/${s.slug}`;
    const have = await meta.match(marker).then((r) => r && r.text());
    if (have === String(s.current)) continue;
    try {
      const detail = await fetch(`/api/sites/${s.slug}`, { cache: "no-store" }).then((r) => r.json());
      await caches.delete(siteCache(s.slug));
      const cache = await caches.open(siteCache(s.slug));
      const base = `/s/${encodeURIComponent(s.slug)}/`;
      const urls = [base, ...detail.fileList.map((f) => base + f.split("/").map(encodeURIComponent).join("/"))];
      await Promise.all(urls.map(async (u) => {
        const res = await fetch(u, { cache: "no-cache" });
        if (res.ok) await cache.put(location.origin + u, res);
      }));
      await meta.put(marker, new Response(String(s.current)));
    } catch { /* offline or server gone; try again next sync */ }
  }
}

self.addEventListener("message", (e) => {
  if (e.data?.type === "sync") e.waitUntil(syncSites(e.data.sites || []));
});

/* ---------- share target ---------- */

async function receiveShare(req) {
  const form = await req.formData();
  const cache = await caches.open(SHARE);
  for (const k of await cache.keys()) await cache.delete(k);
  let i = 0;
  for (const file of form.getAll("files")) {
    if (!(file instanceof File)) continue;
    await cache.put(`/__sitebox/share/${i++}`, new Response(file, {
      headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(file.name) },
    }));
  }
  return Response.redirect("/#/share", 303);
}
