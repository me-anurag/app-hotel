/* Details dialog: info, rename, version history with rollback, download, delete. */
import { $, esc, fmtBytes, timeAgo, toast } from "./ui.js";
import { api } from "./api.js";
import { refresh } from "./store.js";
import { zipFiles } from "./zip.js";

let slug = null;

/** Build the .zip in the browser from the live version's files. */
async function download(site, btn) {
  btn.disabled = true;
  try {
    const entries = await Promise.all(site.fileList.map(async (path) => {
      const res = await fetch(api.fileUrl(site.slug, path));
      if (!res.ok) throw new Error(`Couldn't fetch ${path}`);
      return { path, file: await res.blob() };
    }));
    const url = URL.createObjectURL(await zipFiles(entries));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${site.slug}-v${site.current}.zip` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) { toast(err.message, { error: true }); }
  btn.disabled = false;
}

function render(site) {
  $("#d-title").textContent = site.title;
  const sourceLabel = { cli: "VS Code / CLI", watch: "auto-push", app: "app upload", seed: "bundled", upload: "upload" };
  $("#d-body").innerHTML = `
    <dl class="kv">
      <dt>Address</dt><dd><a href="${esc(site.url)}" target="_blank" rel="noopener">${esc(location.origin + site.url)}</a></dd>
      <dt>Name</dt><dd><code>${esc(site.slug)}</code></dd>
      <dt>Entry</dt><dd><code>${esc(site.entry)}</code></dd>
      <dt>Size</dt><dd>${site.files} files · ${fmtBytes(site.bytes)}</dd>
      <dt>Created</dt><dd>${new Date(site.createdAt).toLocaleString()}</dd>
    </dl>

    <form class="rename" id="d-rename">
      <label class="field" style="flex:1;margin:0"><span>Title</span>
        <div class="rename"><input id="d-title-input" value="${esc(site.title)}" maxlength="120"><button class="btn">Save</button></div>
      </label>
    </form>

    <div class="section-h">History</div>
    <ul class="versions">
      ${site.versions.map((v) => `<li>
        <span class="vid">v${v.id}</span>
        <span class="vinfo">${esc(v.message || "No note")}
          <small>${timeAgo(v.createdAt)} · ${esc(sourceLabel[v.source] || v.source)} · ${v.files} files · ${fmtBytes(v.bytes)}</small></span>
        ${v.id === site.current ? '<span class="live">Live</span>' : `<button class="btn small" data-rollback="${v.id}">Make live</button>`}
      </li>`).join("")}
    </ul>

    <div class="actions-row">
      <button class="btn" id="d-download">Download .zip</button>
      <a class="btn" href="${esc(site.url)}" target="_blank" rel="noopener">Open in new tab</a>
      <span class="spacer"></span>
      <button class="btn danger" id="d-delete">Delete site</button>
    </div>`;

  $("#d-download").onclick = (e) => download(site, e.currentTarget);

  $("#d-rename").onsubmit = async (e) => {
    e.preventDefault();
    try {
      render(await api.rename(slug, $("#d-title-input").value));
      toast("Title saved");
      refresh();
    } catch (err) { toast(err.message, { error: true }); }
  };

  $("#d-delete").onclick = async () => {
    if (!confirm(`Delete “${site.title}” and all ${site.versions.length} versions? This can't be undone.`)) return;
    try {
      await api.remove(slug);
      $("#dlg-details").close();
      toast(`Deleted ${site.title}`);
      if (location.hash.startsWith("#/view/")) location.hash = "#/";
      refresh();
    } catch (err) { toast(err.message, { error: true }); }
  };
}

export async function openDetails(s) {
  slug = s;
  $("#d-body").innerHTML = '<p class="muted">Loading…</p>';
  $("#dlg-details").showModal();
  try { render(await api.get(slug)); }
  catch (err) { $("#d-body").innerHTML = `<p>${esc(err.message)}</p>`; }
}

export function initDetails() {
  $("#d-body").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rollback]");
    if (!b) return;
    b.disabled = true;
    try {
      const site = await api.rollback(slug, Number(b.dataset.rollback));
      render(site);
      toast(`v${site.current} is live`);
      refresh();
    } catch (err) { toast(err.message, { error: true }); b.disabled = false; }
  });
}
