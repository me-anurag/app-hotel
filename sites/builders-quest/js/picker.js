/* "What are you building?" dialog. */
import { TYPES } from "./data/types.js";
import { state, selectType } from "./state.js";

const $ = (id) => document.getElementById(id);

export function openPicker() {
  const groups = [...new Set(TYPES.map((t) => t.grp))];
  $("typelist").innerHTML = groups.map((g) => `
    <div class="group"><h4>${g}</h4><div class="chips">
    ${TYPES.filter((t) => t.grp === g).map((t) => `<button class="chip ${t.id === state.typeId ? "sel" : ""}" data-type="${t.id}">${t.name}</button>`).join("")}
    </div></div>`).join("");
  $("dlg").showModal();
}

export function initPicker({ onSelect }) {
  const dlg = $("dlg");
  $("typelist").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-type]");
    if (!chip) return;
    selectType(chip.dataset.type);
    dlg.close();
    onSelect();
  });
  $("pick").onclick = openPicker;
  $("close").onclick = () => dlg.close();
}
