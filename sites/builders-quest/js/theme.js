/* Day / night toggle. Follows the system until the user picks one. */
import { storage } from "./storage.js";

const root = document.documentElement;
const media = matchMedia("(prefers-color-scheme: dark)");

const themeNow = () => root.dataset.theme || (media.matches ? "dark" : "light");

function updateLabel() {
  const dark = themeNow() === "dark";
  document.getElementById("tlabel").textContent = dark ? "Night" : "Day";
  document.getElementById("theme").setAttribute("aria-label", dark ? "Switch to day mode" : "Switch to night mode");
}

export function initTheme() {
  const saved = storage.get("bq-theme", null);
  if (saved) root.dataset.theme = saved;
  updateLabel();

  document.getElementById("theme").onclick = () => {
    root.dataset.theme = themeNow() === "dark" ? "light" : "dark";
    storage.set("bq-theme", root.dataset.theme);
    updateLabel();
  };
  media.addEventListener("change", updateLabel);
}
