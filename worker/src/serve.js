/* Serves stored sites at /s/<slug>/<path>: path -> content hash from D1, bytes from KV.
   Content never changes for a given hash, so the hash is a perfect ETag. */
import { blobKey } from "./db.js";
import { canRead } from "./auth.js";
import { escapeHtml, mimeFor } from "./util.js";

const page = (status, title, body) => new Response(
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title>
   <body style="font:16px system-ui;padding:40px;max-width:560px;margin:auto;color:#334"><h1>${title}</h1>${body}
   <p><a href="/">Back to Sitebox</a></p>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? size - 1 : Number(m[2]);
  start = Math.max(0, start); end = Math.min(size - 1, end);
  return start <= end ? { start, end } : null;
}

export async function serveSite(req, env, url) {
  const m = /^\/s\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  if (m[2] === undefined) return Response.redirect(`${url.origin}/s/${m[1]}/${url.search}`, 301);

  if (!canRead(req, env)) return page(401, "Private site", "<p>Open Sitebox and enter your token to view this site.</p>");

  let rel;
  try { rel = decodeURIComponent(m[2].slice(1)); } catch { return page(400, "Bad address", ""); }
  if (rel.includes("\\") || rel.includes("\0") || rel.split("/").some((s) => s === "..")) return page(400, "Bad address", "");

  const site = await env.DB.prepare("SELECT title, entry, current FROM sites WHERE slug = ? AND current > 0").bind(slug).first();
  if (!site) return page(404, "Not found", `<p>There's no site called <b>${escapeHtml(slug)}</b>.</p>`);

  const candidates = rel === "" ? ["index.html", site.entry]
    : rel.endsWith("/") ? [rel + "index.html"]
    : [rel, rel + ".html", rel + "/index.html"];
  const { results } = await env.DB.prepare(
    "SELECT path, hash, size FROM files WHERE slug = ? AND version = ? AND path IN (SELECT value FROM json_each(?))")
    .bind(slug, site.current, JSON.stringify(candidates)).all();
  const file = candidates.map((c) => results.find((r) => r.path === c)).find(Boolean);
  if (!file) return page(404, "Not found", `<p><code>${escapeHtml(rel)}</code> isn't part of <b>${escapeHtml(site.title)}</b>.</p>`);

  const etag = `"${file.hash}"`;
  const headers = new Headers({
    "Content-Type": mimeFor(file.path), ETag: etag, "Cache-Control": "no-cache", "Accept-Ranges": "bytes",
  });
  const inm = req.headers.get("If-None-Match");
  if (inm && inm.split(",").map((s) => s.trim().replace(/^W\//, "")).includes(etag)) return new Response(null, { status: 304, headers });

  const range = parseRange(req.headers.get("Range"), file.size);
  if (range) {
    const buf = await env.FILES.get(blobKey(file.hash), { type: "arrayBuffer", cacheTtl: 86400 });
    if (!buf) return page(500, "File missing", "<p>Push the site again to repair it.</p>");
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    return new Response(req.method === "HEAD" ? null : buf.slice(range.start, range.end + 1), { status: 206, headers });
  }

  headers.set("Content-Length", String(file.size));
  if (req.method === "HEAD") return new Response(null, { headers });
  const body = await env.FILES.get(blobKey(file.hash), { type: "stream", cacheTtl: 86400 });
  if (!body) return page(500, "File missing", "<p>Push the site again to repair it.</p>");
  return new Response(body, { headers });
}
