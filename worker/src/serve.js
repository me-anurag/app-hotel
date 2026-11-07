/* Serves stored sites at /s/<slug>/<path> straight from R2, with ETag and Range support. */
import { readDb, fileKey, isLive } from "./db.js";
import { canRead } from "./auth.js";
import { escapeHtml } from "./util.js";

const page = (status, title, body) => new Response(
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title>
   <body style="font:16px system-ui;padding:40px;max-width:560px;margin:auto;color:#334"><h1>${title}</h1>${body}
   <p><a href="/">Back to Sitebox</a></p>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export async function serveSite(req, env, url) {
  const m = /^\/s\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  if (m[2] === undefined) return Response.redirect(`${url.origin}/s/${m[1]}/${url.search}`, 301);

  if (!canRead(req, env)) {
    return page(401, "Private site", "<p>Open Sitebox and enter your token to view this site.</p>");
  }

  let rel;
  try { rel = decodeURIComponent(m[2].slice(1)); } catch { return page(400, "Bad address", ""); }
  if (rel.includes("\\") || rel.includes("\0") || rel.split("/").some((s) => s === "..")) return page(400, "Bad address", "");

  const { data } = await readDb(env, { maxAgeMs: 1500 });
  const site = data.sites[slug];
  if (!isLive(site)) return page(404, "Not found", `<p>There's no site called <b>${escapeHtml(slug)}</b>.</p>`);

  const candidates = rel === "" ? ["index.html", site.entry]
    : rel.endsWith("/") ? [rel + "index.html"]
    : [rel, rel + ".html", rel + "/index.html"];

  for (const c of candidates) {
    const obj = await env.BUCKET.get(fileKey(slug, site.current, c), { onlyIf: req.headers, range: req.headers });
    if (!obj) continue;

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("ETag", obj.httpEtag);
    headers.set("Cache-Control", "no-cache");
    headers.set("Accept-Ranges", "bytes");

    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });   // If-None-Match hit

    if (req.headers.has("Range") && obj.range) {
      const offset = obj.range.offset ?? obj.size - obj.range.suffix;
      const length = obj.range.length ?? obj.size - offset;
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set("Content-Length", String(length));
      return new Response(req.method === "HEAD" ? null : obj.body, { status: 206, headers });
    }
    headers.set("Content-Length", String(obj.size));
    return new Response(req.method === "HEAD" ? null : obj.body, { headers });
  }
  return page(404, "Not found", `<p><code>${escapeHtml(rel)}</code> isn't part of <b>${escapeHtml(site.title)}</b>.</p>`);
}
