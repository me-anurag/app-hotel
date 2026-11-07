/* Site index stored as one JSON object in R2 ("db.json"), updated with
   optimistic concurrency (etag check + retry) so parallel pushes never clobber.

   R2 layout:
     db.json                    { rev, sites: { <slug>: SiteMeta } }
     f/<slug>/<version>/<path>  site files
     m/<slug>/<version>.json    manifest: { paths: [...] } for a version
*/
import { HttpError } from "./util.js";

const DB_KEY = "db.json";
let cache = null;   // { data, etag, at } per isolate, short-lived, for fast site serving

export const fileKey = (slug, v, path) => `f/${slug}/${v}/${path}`;
export const manifestKey = (slug, v) => `m/${slug}/${v}.json`;

export async function readDb(env, { maxAgeMs = 0 } = {}) {
  if (maxAgeMs && cache && Date.now() - cache.at < maxAgeMs) return cache;
  const obj = await env.BUCKET.get(DB_KEY);
  cache = obj
    ? { data: await obj.json(), etag: obj.etag, at: Date.now() }
    : { data: { rev: 0, sites: {} }, etag: null, at: Date.now() };
  return cache;
}

/** Apply fn(data) and save; retries if another request saved first. fn must only touch `data`. */
export async function mutate(env, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, etag } = await readDb(env);
    const copy = structuredClone(data);
    const result = await fn(copy);
    copy.rev = (copy.rev || 0) + 1;
    const saved = await env.BUCKET.put(DB_KEY, JSON.stringify(copy), {
      httpMetadata: { contentType: "application/json" },
      ...(etag ? { onlyIf: { etagMatches: etag } } : {}),
    });
    if (saved) {
      cache = { data: copy, etag: saved.etag, at: Date.now() };
      return result;
    }
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 120));
  }
  throw new HttpError(409, "Too many simultaneous changes, please try again");
}

export function summarise(site) {
  const cur = site.versions.find((v) => v.id === site.current) || {};
  return {
    slug: site.slug, title: site.title, entry: site.entry, current: site.current,
    url: `/s/${site.slug}/`, files: cur.files || 0, bytes: cur.bytes || 0,
    createdAt: site.createdAt, updatedAt: site.updatedAt, versionCount: site.versions.length,
  };
}

export const isLive = (site) => site && site.versions.length > 0;

/** Delete every object under a prefix (batched, paginated). */
export async function deletePrefix(env, prefix) {
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length) await env.BUCKET.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

/** Map of path -> size for every object under a prefix. */
export async function listSizes(env, prefix) {
  const out = new Map();
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) out.set(o.key.slice(prefix.length), o.size);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}
