/* Upload dialog: pick or drop an HTML file, several files, a folder, or a .zip. */
import { $, esc, fmtBytes, slugify, toast } from "./ui.js";
import { api } from "./api.js";
import { unzipFile } from "./zip.js";
import { refresh, findSite } from "./store.js";

/** @type {{kind: "html"|"zip"|"files", label: string, entries: {path: string, file: File}[]}|null} */
let picked = null;

/* ---------- collecting files ---------- */

function fromFileList(files, { folder = false } = {}) {
  const list = [...files];
  if (!list.length) return null;
  if (list.length === 1 && /\.zip$/i.test(list[0].name)) {
    return { kind: "zip", label: list[0].name, entries: [{ path: list[0].name, file: list[0] }] };
  }
  const entries = list.map((f) => ({ path: (folder && f.webkitRelativePath) || f.name, file: f }));
  if (entries.length === 1 && /\.html?$/i.test(entries[0].path)) {
    return { kind: "html", label: entries[0].path, entries };
  }
  const top = folder && entries[0].path.includes("/") ? entries[0].path.split("/")[0] : "";
  return { kind: "files", label: top || `${entries.length} files`, entries };
}

/** Walk dropped folders using the File System Entry API. */
async function fromDrop(dt) {
  const roots = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!roots.length) return fromFileList(dt.files);
  if (roots.length === 1 && roots[0].isFile) return fromFileList(dt.files);

  const entries = [];
  const readAll = (reader) => new Promise((res, rej) => {
    const out = [];
    const next = () => reader.readEntries((batch) => batch.length ? (out.push(...batch), next()) : res(out), rej);
    next();
  });
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      entries.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child, `${prefix}${entry.name}/`);
    }
  }
  for (const r of roots) await walk(r, "");
  const folderName = roots.length === 1 && roots[0].isDirectory ? roots[0].name : "";
  return { kind: "files", label: folderName || `${entries.length} files`, entries };
}

/* ---------- dialog ---------- */

function suggestSlug(p) {
  const base = p.kind === "files" && p.label.endsWith(" files")
    ? (p.entries.find((e) => /index\.html?$/i.test(e.path))?.path.split("/").slice(-2, -1)[0] || "site")
    : p.label.replace(/^index\.html?$/i, "site");
  return slugify(base) || "site";
}

function updateSlugHint() {
  const slug = $("#f-slug").value.trim();
  const existing = findSite(slug);
  const hint = $("#f-slug-hint");
  hint.classList.toggle("warn", !!existing);
  hint.innerHTML = existing
    ? `“${esc(existing.title)}” already uses this name. Uploading publishes <b>v${existing.current + 1}</b> (older versions are kept).`
    : `Lowercase letters, digits and dashes. Becomes the address /s/<i>${esc(slug || "name")}</i>/`;
}

function showPicked(p) {
  picked = p;
  if (!p) return;
  const total = p.entries.reduce((s, e) => s + e.file.size, 0);
  const hasHtml = p.kind === "zip" || p.entries.some((e) => /\.html?$/i.test(e.path));
  $("#picked").innerHTML = `<div class="ico">${p.kind === "zip" ? "ZIP" : p.kind === "html" ? "HTML" : "DIR"}</div>
    <div><b>${esc(p.label)}</b><small>${p.kind === "zip" ? "Zip archive" : `${p.entries.length} file${p.entries.length === 1 ? "" : "s"}`} · ${fmtBytes(total)}</small></div>`;
  if (!hasHtml) { toast("No .html file in that selection. A site needs at least one.", { error: true }); return resetPick(); }
  $("#f-slug").value = suggestSlug(p);
  $("#f-title").value = "";
  $("#f-message").value = "";
  updateSlugHint();
  $("#drop").hidden = true;
  $("#upload-form").hidden = false;
  $("#f-slug").focus();
}

function resetPick() {
  picked = null;
  $("#drop").hidden = false;
  $("#upload-form").hidden = true;
  $("#progress").hidden = true;
  for (const id of ["#pick-files", "#pick-folder", "#pick-zip"]) $(id).value = "";
}

export function openUpload(preset) {
  resetPick();
  $("#dlg-upload").showModal();
  if (preset) showPicked(preset);
}

/** Open the dialog pre-filled with files from the share sheet / file handler. */
export function openUploadWithFiles(files) {
  const p = fromFileList(files);
  if (p) openUpload(p);
}

async function submit(e) {
  e.preventDefault();
  if (!picked) return;
  const slug = $("#f-slug").value.trim();
  const go = $("#upload-go"), bar = $("#progress");
  go.disabled = true;
  bar.hidden = false;
  bar.style.setProperty("--p", "0%");
  try {
    const entries = picked.kind === "zip" ? await unzipFile(picked.entries[0].file) : picked.entries;
    if (!entries.some((e) => /\.html?$/i.test(e.path))) throw new Error("That zip has no .html file in it.");

    const site = await api.upload(slug, entries, {
      title: $("#f-title").value.trim(), message: $("#f-message").value.trim(),
      onProgress: (p) => bar.style.setProperty("--p", `${Math.round(p * 100)}%`),
    });
    $("#dlg-upload").close();
    toast(`Published ${site.title} v${site.current}`);
    await refresh();
    location.hash = `#/view/${site.slug}`;
  } catch (err) {
    toast(err.message, { error: true, ms: 5000 });
  } finally {
    go.disabled = false;
  }
}

export function initUpload() {
  $("#pick-files").onchange = (e) => showPicked(fromFileList(e.target.files));
  $("#pick-folder").onchange = (e) => showPicked(fromFileList(e.target.files, { folder: true }));
  $("#pick-zip").onchange = (e) => showPicked(fromFileList(e.target.files));
  $("#upload-reset").onclick = resetPick;
  $("#upload-form").onsubmit = submit;
  $("#f-slug").addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    e.target.setSelectionRange(pos, pos);
    updateSlugHint();
  });

  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    showPicked(await fromDrop(e.dataTransfer));
  });

  // Dropping anywhere on the library opens the dialog with those files.
  document.addEventListener("dragover", (e) => { if (!$("#dlg-upload").open && e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", async (e) => {
    if ($("#dlg-upload").open || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    const p = await fromDrop(e.dataTransfer);
    if (p) openUpload(p);
  });
}
