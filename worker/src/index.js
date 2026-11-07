/* Sitebox on Cloudflare Workers.
   - /api/*        JSON API (token-protected writes; reads too unless PUBLIC_READ="true")
   - /s/<slug>/*   stored sites (index in D1, contents in KV)
   - everything else: the PWA shell from static assets (./app)

   Upload protocol (content-addressed; each request stays tiny on CPU, so the free plan is enough):
     POST /api/sites/:slug/uploads                {files:[{path,size,hash}], title?, message?, source?}
                                                  -> {version, paths, missing: [hash...]}
     PUT  /api/sites/:slug/uploads/:v/blobs/:hash raw bytes, only for hashes listed in "missing"
     POST /api/sites/:slug/uploads/:v/commit      -> site summary (now live)
   Shortcut: PUT /api/sites/:slug with a single HTML body (?filename=&title=&message=). */
import { HttpError, json } from "./util.js";
import { getRev } from "./db.js";
import { isAuthed, publicRead, requireRead, requireWrite, sessionCookie, safeEqual } from "./auth.js";
import * as sites from "./sites.js";
import { serveSite } from "./serve.js";

async function readJson(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "Expected a JSON body"); }
}

async function api(req, env, ctx, url) {
  const parts = url.pathname.split("/").slice(2).map(decodeURIComponent);   // after "/api/"
  const [section, slug, action, ...rest] = parts;
  const method = req.method;

  if (section === "ping" && method === "GET") {
    const authed = isAuthed(req, env);
    const rev = authed || publicRead(env) ? await getRev(env) : null;
    return json({ ok: true, name: "sitebox", authed, publicRead: publicRead(env), rev });
  }

  if (section === "session") {
    if (method === "POST") {
      const { token } = await readJson(req);
      if (!env.SITEBOX_TOKEN || typeof token !== "string" || !safeEqual(token, env.SITEBOX_TOKEN)) throw new HttpError(401, "That token isn't right");
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, req) });
    }
    if (method === "DELETE") return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", req) });
  }

  if (section !== "sites") throw new HttpError(404, "Unknown endpoint");

  if (!slug) {
    if (method !== "GET") throw new HttpError(405, "Method not allowed");
    requireRead(req, env);
    return json({ sites: await sites.listSites(env) });
  }

  if (method === "GET" && !action) {
    requireRead(req, env);
    const site = await sites.getSite(env, slug);
    if (!site) throw new HttpError(404, "Site not found");
    return json(site);
  }

  requireWrite(req, env);

  if (action === "uploads") {
    const [v, step, hash] = rest;
    if (method === "POST" && !v) return json(await sites.beginUpload(env, slug, await readJson(req)), 201);
    const version = Number(v);
    if (!Number.isInteger(version)) throw new HttpError(400, "Bad version");
    if (method === "POST" && step === "commit") return json(await sites.commitUpload(env, ctx, slug, version), 201);
    if (method === "PUT" && step === "blobs" && hash) return json(await sites.putBlob(env, req, slug, version, hash));
  }

  if (method === "PUT" && !action) {
    return json(await sites.putSingleHtml(env, ctx, req, slug, url.searchParams.get("filename")), 201);
  }
  if (method === "POST" && action === "rollback") return json(await sites.rollback(env, slug, (await readJson(req)).version));
  if (method === "PATCH" && !action) return json(await sites.rename(env, slug, (await readJson(req)).title));
  if (method === "DELETE" && !action) { await sites.removeSite(env, ctx, slug); return json({ ok: true }); }

  throw new HttpError(405, "Method not allowed");
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, env, ctx, url);
      if (url.pathname.startsWith("/s/")) return await serveSite(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: err.message || "Server error" }, status);
    }
  },

  // Daily cleanup of abandoned uploads and unused file contents (see triggers in wrangler.toml).
  async scheduled(_event, env) {
    await sites.cleanup(env);
  },
};
