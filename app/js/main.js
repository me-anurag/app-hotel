/* Sitebox app entry: wires modules together and handles hash routing.
   Routes:  #/            library
            #/view/<slug> full-screen viewer
            #/upload      open the upload dialog
            #/share       files arriving from the share sheet */
import { $, toast } from "./ui.js";
import { refresh, state, subscribe } from "./store.js";
import { initLibrary } from "./library.js";
import { initViewer, showViewer, hideViewer } from "./viewer.js";
import { initUpload, openUpload, openUploadWithFiles } from "./upload.js";
import { initDetails } from "./details.js";
import { initOffline, initLiveUpdates, takeSharedFiles } from "./offline.js";
import { ensureSession } from "./api.js";

async function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [page, arg] = hash.split("/");

  if (page === "view" && arg) return showViewer(decodeURIComponent(arg));
  hideViewer();

  if (page === "upload") { history.replaceState(null, "", "#/"); openUpload(); }
  if (page === "share") {
    history.replaceState(null, "", "#/");
    const files = await takeSharedFiles();
    if (files.length) openUploadWithFiles(files);
    else toast("Nothing was shared", { error: true });
  }
}

function renderStatus() {
  const el = $("#status");
  el.classList.toggle("offline", !state.online);
  el.lastElementChild.textContent = state.online ? "Online" : "Offline";
  el.title = state.online ? "Connected to your Sitebox server" : "Offline: showing sites saved on this device";
}

initLibrary();
initViewer();
initUpload();
initDetails();
subscribe(renderStatus);

addEventListener("hashchange", route);
route();

await ensureSession();   // refresh the cookie so private sites load in iframes
await refresh();
initOffline();
initLiveUpdates();

// Opening .html/.zip files with the installed app (File Handling API, desktop Chrome/Edge).
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    openUploadWithFiles(await Promise.all(files.map((h) => h.getFile())));
  });
}
