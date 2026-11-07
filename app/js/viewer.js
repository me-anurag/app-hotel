/* Full-screen viewer: shows a stored site in an iframe under a slim toolbar. */
import { $, timeAgo } from "./ui.js";
import { findSite, subscribe } from "./store.js";
import { openDetails } from "./details.js";

let currentSlug = null;
let shownVersion = null;

function fill() {
  const s = findSite(currentSlug);
  $("#v-title").textContent = s ? s.title : currentSlug;
  $("#v-meta").textContent = s ? `v${s.current} · updated ${timeAgo(s.updatedAt)}` : "";
  document.title = `${s ? s.title : currentSlug} · Sitebox`;
}

export function showViewer(slug) {
  const frame = $("#v-frame");
  const url = `/s/${encodeURIComponent(slug)}/`;
  if (currentSlug !== slug) {
    frame.src = url;
    currentSlug = slug;
    shownVersion = findSite(slug)?.current ?? null;
  }
  $("#v-external").href = url;
  fill();
  $("#viewer").hidden = false;
  $("#library").hidden = true;
}

export function hideViewer() {
  $("#viewer").hidden = true;
  $("#library").hidden = false;
  $("#v-frame").src = "about:blank";
  currentSlug = null;
  document.title = "Sitebox";
}

export function initViewer() {
  $("#v-reload").onclick = () => { $("#v-frame").contentWindow?.location.reload(); };
  $("#v-details").onclick = () => currentSlug && openDetails(currentSlug);
  // A new push (or rollback) of the open site reloads it live, like a dev server.
  subscribe(() => {
    if (!currentSlug) return;
    const s = findSite(currentSlug);
    if (s && shownVersion === null) shownVersion = s.current;   // opened before the list loaded
    else if (s && s.current !== shownVersion) {
      shownVersion = s.current;
      $("#v-frame").src = `/s/${encodeURIComponent(currentSlug)}/?v=${s.current}`;
    }
    fill();
  });
}
