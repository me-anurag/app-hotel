/* Service worker registration, offline sync, change polling and connection status. */
import { refresh, setOnline, subscribe } from "./store.js";
import { api } from "./api.js";

export async function initOffline() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (e) {
    console.warn("Service worker not registered (needs https or localhost):", e);
    return;
  }
  // After every refresh, have the worker cache any new or changed site versions.
  subscribe(async (state) => {
    if (!state.online || !state.sites.length) return;
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: "sync", sites: state.sites.map(({ slug, current }) => ({ slug, current })) });
  });
}

/**
 * Pushes from VS Code or other devices show up within a few seconds: poll the tiny
 * /api/ping endpoint (it returns a revision number that changes on every write).
 */
export function initLiveUpdates({ everyMs = 4000 } = {}) {
  let lastRev = null, timer = null;

  async function tick() {
    clearTimeout(timer);
    try {
      const ping = await api.ping();
      if (!ping) throw new Error("bad response");
      setOnline(true);
      if (ping.rev !== null && lastRev !== null && ping.rev !== lastRev) refresh();
      lastRev = ping.rev;
    } catch {
      setOnline(false);
    }
    if (document.visibilityState === "visible") timer = setTimeout(tick, everyMs);
  }

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  addEventListener("online", tick);
  addEventListener("offline", () => setOnline(false));
  tick();
}

/** Files shared to the installed app (Android share sheet) are waiting in the cache. */
export async function takeSharedFiles() {
  if (!("caches" in window)) return [];
  const cache = await caches.open("sitebox-share");
  const files = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    const name = decodeURIComponent(res.headers.get("X-Filename") || "shared.html");
    files.push(new File([await res.blob()], name, { type: res.headers.get("Content-Type") || "" }));
    await cache.delete(req);
  }
  return files;
}
