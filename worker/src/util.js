/* Shared helpers: errors, JSON responses, MIME types, path rules. */

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertSlug(slug) {
  if (!SLUG_RE.test(slug)) throw new HttpError(400, `Invalid site name "${slug}". Use lowercase letters, digits and dashes.`);
}

const IGNORE_DIRS = new Set(["node_modules", ".git", ".vscode", ".idea", "__MACOSX", ".sitebox"]);
const IGNORE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "sitebox.json"]);

function isIgnored(p) {
  const parts = p.split("/");
  if (IGNORE_FILES.has(parts.at(-1))) return true;
  return parts.slice(0, -1).some((d) => IGNORE_DIRS.has(d) || (d.startsWith(".") && d !== ".well-known"));
}

/** Clean one path, or throw if it tries to escape the site. */
export function cleanPath(raw) {
  const p = String(raw).replace(/\\/g, "/");
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." || seg.includes("\0") || /^[a-zA-Z]:$/.test(seg)) throw new HttpError(400, `Unsafe path in upload: ${raw}`);
    out.push(seg);
  }
  if (!out.length) throw new HttpError(400, `Empty path in upload`);
  return out.join("/");
}

/**
 * Normalise an upload manifest: clean paths, drop junk files, strip one shared
 * top-level folder ("my-site/index.html" -> "index.html"). Returns paths in the
 * same order as given, with null for dropped files.
 */
export function normaliseManifest(paths) {
  let list = paths.map((p) => { const c = cleanPath(p); return isIgnored(c) ? null : c; });
  const kept = () => list.filter(Boolean);
  if (!kept().length) throw new HttpError(400, "Upload contained no files");
  while (!kept().some((p) => !p.includes("/"))) {
    const top = kept()[0].split("/")[0];
    if (!kept().every((p) => p.startsWith(top + "/"))) break;
    list = list.map((p) => (p ? p.slice(top.length + 1) : p));
  }
  const seen = new Set();
  for (const p of kept()) {
    if (seen.has(p)) throw new HttpError(400, `Duplicate file in upload: ${p}`);
    seen.add(p);
  }
  return list;
}

export function pickEntry(paths) {
  const html = paths.filter((p) => /\.html?$/i.test(p));
  const root = html.filter((p) => !p.includes("/"));
  const entry = root.find((p) => /^index\.html?$/i.test(p)) || root[0] || html[0];
  if (!entry) throw new HttpError(400, "No HTML file found. A site needs at least one .html file.");
  return entry;
}

export function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, " ").trim().replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"') : "";
}

const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json", map: "application/json", txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8", xml: "application/xml", csv: "text/csv; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf", wasm: "application/wasm", zip: "application/zip",
};
export const mimeFor = (p) => MIME[p.split(".").pop().toLowerCase()] || "application/octet-stream";

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
