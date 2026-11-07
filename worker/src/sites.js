/* Site operations: upload sessions (begin -> put files -> commit), rollback, rename, delete. */
import { HttpError, assertSlug, normaliseManifest, pickEntry, extractTitle, mimeFor, cleanPath } from "./util.js";
import { readDb, mutate, summarise, isLive, fileKey, manifestKey, deletePrefix, listSizes } from "./db.js";

const MAX_FILES = 5000;
const PENDING_TTL_MS = 24 * 3600 * 1000;

export async function listSites(env) {
  const { data } = await readDb(env);
  return Object.values(data.sites).filter(isLive).map(summarise)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getSite(env, slug) {
  const { data } = await readDb(env);
  const site = data.sites[slug];
  if (!isLive(site)) return null;
  const man = await env.BUCKET.get(manifestKey(slug, site.current));
  const fileList = man ? (await man.json()).paths : [];
  return { ...summarise(site), versions: [...site.versions].reverse(), fileList };
}

/** Step 1: declare the files. Returns the version number and the cleaned path for each file. */
export async function beginUpload(env, ctx, slug, body) {
  assertSlug(slug);
  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) throw new HttpError(400, "No files declared");
  if (files.length > MAX_FILES) throw new HttpError(413, `Too many files (max ${MAX_FILES})`);
  const maxBytes = (Number(env.MAX_UPLOAD_MB) || 200) * 1024 * 1024;
  const total = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
  if (total > maxBytes) throw new HttpError(413, `Upload too large (max ${env.MAX_UPLOAD_MB || 200} MB)`);

  const paths = normaliseManifest(files.map((f) => f.path));
  const kept = paths.filter(Boolean);
  const entry = pickEntry(kept);

  const { version, stale } = await mutate(env, (data) => {
    const now = new Date().toISOString();
    const site = data.sites[slug] ||= { slug, title: "", entry: "", current: 0, versions: [], nextId: 1, createdAt: now, updatedAt: now };
    const version = site.nextId++;
    const stale = site.pending ? [site.pending.version] : [];
    site.pending = {
      version, paths: kept, entry, createdAt: now,
      title: String(body.title || "").slice(0, 120), message: String(body.message || "").slice(0, 500),
      source: String(body.source || "upload").slice(0, 20),
    };
    return { version, stale };
  });
  // An unfinished earlier upload for this site is abandoned: remove its files.
  for (const v of stale) ctx.waitUntil(deletePrefix(env, `f/${slug}/${v}/`));
  return { version, paths };
}

/** Step 2: store one file of a pending upload. */
export async function putFile(env, req, slug, version, rawPath) {
  const path = cleanPath(rawPath);
  const { data } = await readDb(env, { maxAgeMs: 2000 });
  let p = data.sites[slug]?.pending;
  if (!p || p.version !== version || !p.paths.includes(path)) {
    p = (await readDb(env)).data.sites[slug]?.pending;   // cache may be stale; re-check once
    if (!p || p.version !== version) throw new HttpError(409, "No upload in progress for this version. Start again.");
    if (!p.paths.includes(path)) throw new HttpError(400, `File was not declared in this upload: ${path}`);
  }
  if (!req.body) throw new HttpError(400, "Empty file body");
  await env.BUCKET.put(fileKey(slug, version, path), req.body, { httpMetadata: { contentType: mimeFor(path) } });
  return { ok: true };
}

/** Step 3: check every file arrived, then make the version live. */
export async function commitUpload(env, ctx, slug, version) {
  const { data } = await readDb(env);
  const p = data.sites[slug]?.pending;
  if (!p || p.version !== version) throw new HttpError(409, "No upload in progress for this version.");

  const sizes = await listSizes(env, `f/${slug}/${version}/`);
  const missing = p.paths.filter((x) => !sizes.has(x));
  if (missing.length) throw new HttpError(400, `${missing.length} file(s) never arrived, e.g. ${missing[0]}`);

  const head = await env.BUCKET.get(fileKey(slug, version, p.entry), { range: { offset: 0, length: 65536 } });
  const autoTitle = head ? extractTitle(await head.text()) : "";
  await env.BUCKET.put(manifestKey(slug, version), JSON.stringify({ paths: [...p.paths].sort() }), {
    httpMetadata: { contentType: "application/json" },
  });

  const keep = Number(env.MAX_VERSIONS) || 10;
  const { site, pruned } = await mutate(env, (d) => {
    const site = d.sites[slug];
    if (!site?.pending || site.pending.version !== version) throw new HttpError(409, "Upload was replaced by a newer one.");
    const pend = site.pending;
    const now = new Date().toISOString();
    site.title = pend.title || (site.titleLocked ? site.title : autoTitle) || site.title || slug;
    if (pend.title) site.titleLocked = true;
    site.entry = pend.entry;
    site.current = version;
    site.updatedAt = now;
    site.versions.push({
      id: version, createdAt: now, entry: pend.entry, files: pend.paths.length,
      bytes: pend.paths.reduce((s, x) => s + (sizes.get(x) || 0), 0),
      message: pend.message, source: pend.source,
    });
    delete site.pending;
    const pruned = [];
    while (site.versions.length > keep) {
      const i = site.versions.findIndex((v) => v.id !== site.current);
      pruned.push(site.versions.splice(i, 1)[0].id);
    }
    return { site: summarise(site), pruned };
  });

  for (const v of pruned) {
    ctx.waitUntil(deletePrefix(env, `f/${slug}/${v}/`));
    ctx.waitUntil(env.BUCKET.delete(manifestKey(slug, v)));
  }
  return site;
}

/** Convenience for single-file pushes (curl, CLI): body is one HTML file. */
export async function putSingleHtml(env, ctx, req, slug, filename) {
  const name = /\.html?$/i.test(filename || "") ? cleanPath(filename) : "index.html";
  const url = new URL(req.url);
  const body = { files: [{ path: name, size: Number(req.headers.get("Content-Length")) || 0 }] };
  for (const k of ["title", "message", "source"]) body[k] = url.searchParams.get(k) || "";
  const { version } = await beginUpload(env, ctx, slug, body);
  await env.BUCKET.put(fileKey(slug, version, name), req.body, { httpMetadata: { contentType: mimeFor(name) } });
  return commitUpload(env, ctx, slug, version);
}

export async function rollback(env, slug, version) {
  return mutate(env, (d) => {
    const site = d.sites[slug];
    if (!isLive(site)) throw new HttpError(404, "Site not found");
    const v = site.versions.find((x) => x.id === Number(version));
    if (!v) throw new HttpError(404, `Version ${version} not found`);
    site.current = v.id;
    site.entry = v.entry;
    site.updatedAt = new Date().toISOString();
    return summarise(site);
  }).then(() => getSite(env, slug));
}

export async function rename(env, slug, title) {
  await mutate(env, (d) => {
    const site = d.sites[slug];
    if (!isLive(site)) throw new HttpError(404, "Site not found");
    if (typeof title === "string" && title.trim()) { site.title = title.trim().slice(0, 120); site.titleLocked = true; }
  });
  return getSite(env, slug);
}

export async function removeSite(env, ctx, slug) {
  await mutate(env, (d) => {
    if (!d.sites[slug]) throw new HttpError(404, "Site not found");
    delete d.sites[slug];
  });
  ctx.waitUntil(deletePrefix(env, `f/${slug}/`));
  ctx.waitUntil(deletePrefix(env, `m/${slug}/`));
}

/** Drop uploads that were started but never committed. */
export async function sweepPending(env, ctx) {
  const { data } = await readDb(env);
  const cutoff = Date.now() - PENDING_TTL_MS;
  const stale = Object.values(data.sites).filter((s) => s.pending && Date.parse(s.pending.createdAt) < cutoff);
  if (!stale.length) return;
  await mutate(env, (d) => {
    for (const s of stale) {
      const site = d.sites[s.slug];
      if (!site?.pending) continue;
      if (!site.versions.length) delete d.sites[s.slug]; else delete site.pending;
    }
  });
  for (const s of stale) ctx.waitUntil(deletePrefix(env, `f/${s.slug}/${s.pending.version}/`));
}
