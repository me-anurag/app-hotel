/* Client for the Sitebox API. Handles the token transparently:
   - kept in localStorage and sent as a Bearer header on API calls
   - also exchanged for an HttpOnly cookie (POST /api/session) so site iframes,
     thumbnails and the service worker can read private sites. */
import { $ } from "./ui.js";

const TOKEN_KEY = "sitebox-token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function startSession(token) {
  const res = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error || "That token isn't right");
}

/** Ask for the token until a valid one is entered (or the dialog is closed). */
let asking = null;
function askToken() {
  if (asking) return asking;
  const dlg = $("#dlg-token"), form = $("#token-form"), input = $("#f-token"), err = $("#token-error");
  input.value = "";
  err.hidden = true;
  dlg.showModal();
  asking = new Promise((resolve) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const token = input.value.trim();
      try {
        await startSession(token);
        setToken(token);
        dlg.close("ok");
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    };
    dlg.addEventListener("close", () => { asking = null; resolve(dlg.returnValue === "ok"); }, { once: true });
  });
  dlg.returnValue = "";
  return asking;
}

/** Make sure the cookie session exists when we already hold a token (e.g. after clearing cookies). */
export async function ensureSession() {
  const t = getToken();
  if (t) { try { await startSession(t); } catch { /* token changed; a 401 will prompt */ } }
}

export async function request(method, path, { body, type, retried } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (type) headers["Content-Type"] = type;

  const res = await fetch(path, { method, body, headers })
    .catch(() => { throw new ApiError(0, "Can't reach Sitebox. You may be offline."); });

  if (res.status === 401 && !retried) {
    if (await askToken()) return request(method, path, { body, type, retried: true });
    throw new ApiError(401, "Your Sitebox token is needed for this.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

export const api = {
  ping: () => fetch("/api/ping", { cache: "no-store", headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {} })
    .then((r) => (r.ok ? r.json() : null)),
  list: () => request("GET", "/api/sites").then((d) => d.sites),
  get: (slug) => request("GET", `/api/sites/${slug}`),

  /**
   * Upload a site: declare the files, send them (6 at a time), then commit.
   * @param {{path: string, file: Blob}[]} entries
   */
  async upload(slug, entries, { title, message, onProgress = () => {} }) {
    const begin = await request("POST", `/api/sites/${slug}/uploads`, {
      type: "application/json",
      body: JSON.stringify({ files: entries.map((e) => ({ path: e.path, size: e.file.size })), title, message, source: "app" }),
    });
    const jobs = entries.map((e, i) => ({ file: e.file, path: begin.paths[i] })).filter((j) => j.path);
    const total = jobs.reduce((s, j) => s + j.file.size, 0) || 1;
    let sent = 0, next = 0;
    const lane = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        await request("PUT", `/api/sites/${slug}/uploads/${begin.version}/${enc(j.path)}`, { body: j.file, type: "application/octet-stream" });
        sent += j.file.size;
        onProgress(sent / total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, lane));
    return request("POST", `/api/sites/${slug}/uploads/${begin.version}/commit`);
  },

  rollback: (slug, version) => request("POST", `/api/sites/${slug}/rollback`, { body: JSON.stringify({ version }), type: "application/json" }),
  rename: (slug, title) => request("PATCH", `/api/sites/${slug}`, { body: JSON.stringify({ title }), type: "application/json" }),
  remove: (slug) => request("DELETE", `/api/sites/${slug}`),
  fileUrl: (slug, path) => `/s/${encodeURIComponent(slug)}/${enc(path)}`,
};
