/* Site operations: upload sessions (begin -> send missing contents -> commit), rollback, rename, delete.

   Uploads are content-addressed: the client sends a SHA-256 for every file, the server answers
   with only the hashes it doesn't have yet, so unchanged files are never re-sent or re-stored. */
import { HttpError, assertSlug, normaliseManifest, pickEntry, extractTitle } from "./util.js";
import { HASH_RE, blobKey, bumpRev, collectGarbage, getSummary, listSummaries, sha256Hex } from "./db.js";

const MAX_FILES = 5000;
const PENDING_TTL_MS = 24 * 3600 * 1000;
const now = () => new Date().toISOString();

export const listSites = (env) => listSummaries(env);

export async function getSite(env, slug) {
  const summary = await getSummary(env, slug);
  if (!summary) return null;
  const [versions, files] = await env.DB.batch([
    env.DB.prepare("SELECT id, created_at, entry, files, bytes, message, source FROM versions WHERE slug = ? ORDER BY id DESC").bind(slug),
    env.DB.prepare("SELECT path FROM files WHERE slug = ? AND version = ? ORDER BY path").bind(slug, summary.current),
  ]);
  return {
    ...summary,
    versions: versions.results.map((v) => ({ id: v.id, createdAt: v.created_at, entry: v.entry, files: v.files, bytes: v.bytes, message: v.message, source: v.source })),
    fileList: files.results.map((f) => f.path),
  };
}

/** Step 1: declare the files ({path, size, hash}). Returns the version, cleaned paths and the hashes to send. */
export async function beginUpload(env, slug, body) {
  assertSlug(slug);
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) throw new HttpError(400, "No files declared");
  if (files.length > MAX_FILES) throw new HttpError(413, `Too many files (max ${MAX_FILES})`);
  const maxFile = (Number(env.MAX_FILE_MB) || 25) * 1024 * 1024;
  const maxTotal = (Number(env.MAX_UPLOAD_MB) || 200) * 1024 * 1024;
  let total = 0;
  for (const f of files) {
    if (!HASH_RE.test(f.hash || "")) throw new HttpError(400, `Missing or bad SHA-256 for ${f.path}`);
    if (!Number.isInteger(f.size) || f.size < 0) throw new HttpError(400, `Bad size for ${f.path}`);
    if (f.size > maxFile) throw new HttpError(413, `${f.path} is larger than ${env.MAX_FILE_MB || 25} MB`);
    total += f.size;
  }
  if (total > maxTotal) throw new HttpError(413, `Upload too large (max ${env.MAX_UPLOAD_MB || 200} MB)`);

  const paths = normaliseManifest(files.map((f) => f.path));
  const kept = files.map((f, i) => paths[i] && { path: paths[i], hash: f.hash, size: f.size }).filter(Boolean);
  const entry = pickEntry(kept.map((f) => f.path));
  const t = now();

  const [, alloc] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO sites (slug, created_at, updated_at) VALUES (?, ?, ?)").bind(slug, t, t),
    env.DB.prepare("UPDATE sites SET next_id = next_id + 1 WHERE slug = ? RETURNING next_id - 1 AS version").bind(slug),
  ]);
  const version = alloc.results[0].version;
  const uniq = [...new Set(kept.map((f) => f.hash))];

  const [, have] = await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO pending (slug, version, files, entry, title, message, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(slug, version, JSON.stringify(kept), entry, String(body.title || "").slice(0, 120),
        String(body.message || "").slice(0, 500), String(body.source || "upload").slice(0, 20), t),
    env.DB.prepare("SELECT hash FROM blobs WHERE hash IN (SELECT value FROM json_each(?))").bind(JSON.stringify(uniq)),
  ]);
  const present = new Set(have.results.map((r) => r.hash));
  return { version, paths, missing: uniq.filter((h) => !present.has(h)) };
}

async function loadPending(env, slug, version) {
  const p = await env.DB.prepare("SELECT * FROM pending WHERE slug = ?").bind(slug).first();
  if (!p || p.version !== version) throw new HttpError(409, "No upload in progress for this version. Start again.");
  return { ...p, files: JSON.parse(p.files) };
}

/** Step 2: store the content for one hash of a pending upload. */
export async function putBlob(env, req, slug, version, hash) {
  if (!HASH_RE.test(hash)) throw new HttpError(400, "Bad hash");
  const p = await loadPending(env, slug, version);
  const decl = p.files.find((f) => f.hash === hash);
  if (!decl) throw new HttpError(400, "That content was not declared in this upload");

  const exists = await env.DB.prepare("SELECT 1 FROM blobs WHERE hash = ?").bind(hash).first();
  if (exists) { await req.body?.cancel(); return { ok: true, stored: false }; }

  const buf = await req.arrayBuffer();
  if (buf.byteLength !== decl.size) throw new HttpError(400, `Size mismatch for ${decl.path}`);
  if (buf.byteLength <= 1024 * 1024 && (await sha256Hex(buf)) !== hash) throw new HttpError(400, `Checksum mismatch for ${decl.path}`);

  await env.FILES.put(blobKey(hash), buf);
  await env.DB.prepare("INSERT OR IGNORE INTO blobs (hash, size, created_at) VALUES (?, ?, ?)").bind(hash, buf.byteLength, now()).run();
  return { ok: true, stored: true };
}

/** Step 3: check every content arrived, then make the version live. */
export async function commitUpload(env, ctx, slug, version) {
  const p = await loadPending(env, slug, version);
  const uniq = [...new Set(p.files.map((f) => f.hash))];
  const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM blobs WHERE hash IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(uniq)).first("n");
  if (have !== uniq.length) throw new HttpError(400, `${uniq.length - have} file(s) never arrived. Push again.`);

  const site = await env.DB.prepare("SELECT title, title_locked FROM sites WHERE slug = ?").bind(slug).first();
  const entryFile = p.files.find((f) => f.path === p.entry);
  let autoTitle = "";
  if (entryFile && entryFile.size <= 2 * 1024 * 1024) autoTitle = extractTitle((await env.FILES.get(blobKey(entryFile.hash))) || "");
  const title = p.title || (site.title_locked ? site.title : autoTitle) || site.title || slug;
  const t = now();
  const bytes = p.files.reduce((s, f) => s + f.size, 0);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO files (slug, version, path, hash, size)
                    SELECT ?, ?, json_extract(value, '$.path'), json_extract(value, '$.hash'), json_extract(value, '$.size')
                    FROM json_each(?)`).bind(slug, version, JSON.stringify(p.files)),
    env.DB.prepare(`INSERT INTO versions (slug, id, created_at, entry, files, bytes, message, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(slug, version, t, p.entry, p.files.length, bytes, p.message, p.source),
    env.DB.prepare(`UPDATE sites SET title = ?, title_locked = CASE WHEN ? != '' THEN 1 ELSE title_locked END,
                    entry = ?, current = ?, updated_at = ? WHERE slug = ?`).bind(title, p.title, p.entry, version, t, slug),
    env.DB.prepare("DELETE FROM pending WHERE slug = ? AND version = ?").bind(slug, version),
    bumpRev(env),
  ]);

  // Keep the newest MAX_VERSIONS versions (the live one is always kept).
  const keep = Number(env.MAX_VERSIONS) || 10;
  const { results: old } = await env.DB.prepare(
    "SELECT id FROM versions WHERE slug = ? AND id != ? ORDER BY id DESC LIMIT -1 OFFSET ?").bind(slug, version, keep - 1).all();
  if (old.length) {
    const ids = JSON.stringify(old.map((r) => r.id));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM files WHERE slug = ? AND version IN (SELECT value FROM json_each(?))").bind(slug, ids),
      env.DB.prepare("DELETE FROM versions WHERE slug = ? AND id IN (SELECT value FROM json_each(?))").bind(slug, ids),
    ]);
    ctx.waitUntil(collectGarbage(env));
  }
  return getSummary(env, slug);
}

/** Convenience for single-file pushes (curl): the body is one HTML file. */
export async function putSingleHtml(env, ctx, req, slug, filename) {
  const name = /\.html?$/i.test(filename || "") && !filename.includes("/") ? filename : "index.html";
  const buf = await req.arrayBuffer();
  const hash = await sha256Hex(buf);
  const url = new URL(req.url);
  const body = { files: [{ path: name, size: buf.byteLength, hash }] };
  for (const k of ["title", "message", "source"]) body[k] = url.searchParams.get(k) || "";
  const { version, missing } = await beginUpload(env, slug, body);
  if (missing.length) {
    await env.FILES.put(blobKey(hash), buf);
    await env.DB.prepare("INSERT OR IGNORE INTO blobs (hash, size, created_at) VALUES (?, ?, ?)").bind(hash, buf.byteLength, now()).run();
  }
  return commitUpload(env, ctx, slug, version);
}

export async function rollback(env, slug, version) {
  const v = await env.DB.prepare("SELECT id, entry FROM versions WHERE slug = ? AND id = ?").bind(slug, Number(version)).first();
  if (!v) throw new HttpError(404, `Version ${version} not found`);
  await env.DB.batch([
    env.DB.prepare("UPDATE sites SET current = ?, entry = ?, updated_at = ? WHERE slug = ?").bind(v.id, v.entry, now(), slug),
    bumpRev(env),
  ]);
  return getSite(env, slug);
}

export async function rename(env, slug, title) {
  if (typeof title !== "string" || !title.trim()) throw new HttpError(400, "Title can't be empty");
  const r = await env.DB.prepare("UPDATE sites SET title = ?, title_locked = 1 WHERE slug = ? AND current > 0")
    .bind(title.trim().slice(0, 120), slug).run();
  if (!r.meta.changes) throw new HttpError(404, "Site not found");
  await bumpRev(env).run();
  return getSite(env, slug);
}

export async function removeSite(env, ctx, slug) {
  const res = await env.DB.batch([
    env.DB.prepare("DELETE FROM files WHERE slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM versions WHERE slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM pending WHERE slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM sites WHERE slug = ?").bind(slug),
    bumpRev(env),
  ]);
  if (!res[3].meta.changes) throw new HttpError(404, "Site not found");
  ctx.waitUntil(collectGarbage(env));
}

/** Daily: drop abandoned uploads and file contents nothing uses any more. */
export async function cleanup(env) {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pending WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM sites WHERE current = 0 AND slug NOT IN (SELECT slug FROM pending)"),
  ]);
  while ((await collectGarbage(env)) === 200) { /* keep going in batches */ }
}
