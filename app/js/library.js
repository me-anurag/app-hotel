/* Library screen: searchable grid of site cards with live thumbnails. */
import { $, esc, fmtBytes, timeAgo } from "./ui.js";
import { state, subscribe, refresh } from "./store.js";
import { openDetails } from "./details.js";
import { openUpload } from "./upload.js";
import { openPushHelp } from "./pushhelp.js";

let query = "";
const THUMB_WIDTH = 1280;

function cardHtml(s, i) {
  const letter = esc((s.title || s.slug).trim().charAt(0).toUpperCase());
  return `<article class="card" style="--i:${i}" data-slug="${esc(s.slug)}">
    <a class="card-link" href="#/view/${encodeURIComponent(s.slug)}" aria-label="Open ${esc(s.title)}">
      <div class="thumb"><span class="letter">${letter}</span>
        ${state.online ? `<iframe src="${esc(s.url)}" loading="lazy" tabindex="-1" aria-hidden="true" scrolling="no"></iframe>` : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(s.title || s.slug)}</div>
        <div class="card-meta"><span class="v">v${s.current}</span><span>${timeAgo(s.updatedAt)}</span><span class="size">· ${fmtBytes(s.bytes)}</span></div>
      </div>
    </a>
    <button class="icon-btn more" data-details="${esc(s.slug)}" aria-label="Details for ${esc(s.title)}" title="Details and history">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
    </button>
  </article>`;
}

function emptyHtml() {
  if (state.error && !state.sites.length) {
    return `<h2>Can't load your sites</h2><p>${esc(state.error)}</p>
      <div class="row"><button class="btn" data-action="retry">Try again</button></div>`;
  }
  if (query) return `<h2>No matches</h2><p>Nothing matches “${esc(query)}”.</p>`;
  return `<img src="/icons/icon.svg" width="64" height="64" alt="">
    <h2>Your Sitebox is empty</h2>
    <p>Upload an HTML file, a folder or a .zip, or push straight from VS Code.</p>
    <div class="row"><button class="btn primary" data-action="upload">Upload a site</button>
    <button class="btn" data-action="push">Push from VS Code</button></div>`;
}

let lastKey = "";
function render() {
  const q = query.toLowerCase();
  const list = state.sites.filter((s) => !q || s.title.toLowerCase().includes(q) || s.slug.includes(q));

  // Avoid reloading every thumbnail iframe when nothing visible changed.
  const key = JSON.stringify([q, state.online, list.map((s) => [s.slug, s.current, s.title, s.updatedAt])]);
  $("#count").textContent = state.loaded ? `${state.sites.length} site${state.sites.length === 1 ? "" : "s"}` : "";
  if (key === lastKey) return;
  lastKey = key;

  $("#grid").innerHTML = list.map(cardHtml).join("");
  const empty = $("#empty");
  empty.hidden = !state.loaded || list.length > 0;
  if (!empty.hidden) empty.innerHTML = emptyHtml();
  fitThumbs();
}

/** Scale the 1280px-wide thumbnail iframes to the card width. */
const ro = new ResizeObserver(() => fitThumbs());
function fitThumbs() {
  const thumb = $("#grid .thumb");
  if (thumb) $("#grid").style.setProperty("--k", thumb.clientWidth / THUMB_WIDTH);
}

export function initLibrary() {
  ro.observe($("#grid"));
  subscribe(render);
  $("#search").addEventListener("input", (e) => { query = e.target.value.trim(); render(); });
  $("#btn-upload").onclick = () => openUpload();
  $("#btn-push-help").onclick = openPushHelp;

  document.addEventListener("click", (e) => {
    const d = e.target.closest("[data-details]");
    if (d) { e.preventDefault(); openDetails(d.dataset.details); return; }
    const a = e.target.closest("#empty [data-action]");
    if (!a) return;
    if (a.dataset.action === "upload") openUpload();
    if (a.dataset.action === "push") openPushHelp();
    if (a.dataset.action === "retry") refresh();
  });
  render();
}
