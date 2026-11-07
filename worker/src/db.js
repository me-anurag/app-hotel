/* Storage helpers: D1 holds the index (sites, versions, files), KV holds file contents
   keyed by SHA-256, so identical content is stored once across files, versions and sites. */

export const blobKey = (hash) => `b/${hash}`;
export const HASH_RE = /^[0-9a-f]{64}$/;

export async function getRev(env) {
  return (await env.DB.prepare("SELECT value FROM meta WHERE key = 'rev'").first("value")) ?? 0;
}
export const bumpRev = (env) => env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev'");

const SUMMARY_SQL = `
  SELECT s.slug, s.title, s.entry, s.current, s.created_at, s.updated_at, v.files, v.bytes,
         (SELECT COUNT(*) FROM versions x WHERE x.slug = s.slug) AS version_count
  FROM sites s JOIN versions v ON v.slug = s.slug AND v.id = s.current`;

const toSummary = (r) => ({
  slug: r.slug, title: r.title, entry: r.entry, current: r.current,
  url: `/s/${r.slug}/`, files: r.files, bytes: r.bytes,
  createdAt: r.created_at, updatedAt: r.updated_at, versionCount: r.version_count,
});

export async function listSummaries(env) {
  const { results } = await env.DB.prepare(`${SUMMARY_SQL} ORDER BY s.updated_at DESC`).all();
  return results.map(toSummary);
}

export async function getSummary(env, slug) {
  const r = await env.DB.prepare(`${SUMMARY_SQL} WHERE s.slug = ?`).bind(slug).first();
  return r ? toSummary(r) : null;
}

/** Delete file contents no longer used by any version or in-progress upload. */
export async function collectGarbage(env) {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();   // leave fresh uploads alone
  const { results } = await env.DB.prepare(`
    SELECT hash FROM blobs
    WHERE created_at < ?
      AND hash NOT IN (SELECT hash FROM files)
      AND hash NOT IN (SELECT json_extract(j.value, '$.hash') FROM pending p, json_each(p.files) j)
    LIMIT 200`).bind(cutoff).all();
  if (!results.length) return 0;
  const hashes = results.map((r) => r.hash);
  await env.DB.prepare("DELETE FROM blobs WHERE hash IN (SELECT value FROM json_each(?))").bind(JSON.stringify(hashes)).run();
  for (const h of hashes) await env.FILES.delete(blobKey(h));
  return hashes.length;
}

export async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
