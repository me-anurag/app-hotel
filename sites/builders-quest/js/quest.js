/* Builds the level list for the current type and renders the quest. */
import { CORE } from "./data/levels.js";
import { TOOLS } from "./data/tools.js";
import { state, currentType, saveProgress, setShowTools } from "./state.js";

const $ = (id) => document.getElementById(id);
let onChangeType = () => {};

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const WRENCH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>';

/** "Tools · n" toggle plus the chips for one task (empty if the task has no tools). */
function toolsHtml(id) {
  const list = TOOLS[id];
  if (!list) return "";
  const on = state.showTools || state.openTools.has(id);
  const chips = list.map((t) => t.u
    ? `<a class="tchip" href="${t.u}" target="_blank" rel="noopener noreferrer">${esc(t.n)}${t.oss ? '<span class="oss">open source</span>' : ""}</a>`
    : `<span class="tchip plain">${esc(t.n)}</span>`).join("");
  return `<button class="tbtn ${on ? "on" : ""}" data-tools="${id}" aria-expanded="${on}">${WRENCH}Tools · ${list.length}</button>
  <div class="tools ${on ? "show" : ""}">${chips}</div>`;
}

/** Merge the core levels with the selected type's skips, extra tasks and gates. */
export function buildLevels(type) {
  return CORE.map((L, n) => {
    const items = [];
    L.items.forEach(([id, txt, flag]) => {
      if (flag === "store" && !type.store) return;
      items.push({ id, txt, skip: type.s.includes(id) });
    });
    (type.a[n] || []).forEach((txt, i) => items.push({ id: `${type.id}-${n}-${i}`, txt, type: true }));
    return { n, name: L.name, items, gate: L.gate, extra: type.g[n] || "", fail: L.fail, gid: "gate-" + n };
  });
}

function itemHtml(i, unlocked) {
  const { done, lastId } = state;
  const checked = done[i.id] && !i.skip;
  return `
      <div class="item ${i.skip ? "skipped" : ""} ${checked ? "checked" : ""} ${lastId === i.id ? "pop" : ""}">
        <input type="checkbox" id="cb-${i.id}" data-id="${i.id}" ${checked ? "checked" : ""} ${!unlocked || i.skip ? "disabled" : ""}>
        <div class="ibody"><label class="txt" for="cb-${i.id}">${i.txt}${i.type ? '<span class="tag type">this type</span>' : ""}${i.skip ? '<span class="tag skip">not needed</span>' : ""}</label>
        ${i.skip ? "" : toolsHtml(i.id)}</div>
      </div>`;
}

function levelHtml(L, { state: st, isOpen, cleared, locked, unlocked, cnt, live, all, just }) {
  const { done, lastId } = state;
  return `<section class="level ${st} ${isOpen ? "open" : ""} ${just}" style="--i:${L.n}">
      <button class="lhead" data-toggle="${L.n}">
        <span class="badge">${cleared ? "✓" : locked ? "🔒" : L.n}</span>
        <span class="lt"><span class="name">Level ${L.n} · ${L.name}</span>
        <span class="meta">${locked ? "Locked: clear the previous gate" : cleared ? "Cleared" : `${cnt} of ${live.length} tasks`}</span></span>
        <svg class="chev" width="16" height="16" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <div class="lbody">${L.items.map((i) => itemHtml(i, unlocked)).join("")}
        <div class="gate"><div class="gh">Boss gate</div>
          <label class="item ${done[L.gid] ? "checked" : ""} ${lastId === L.gid ? "pop" : ""}">
            <input type="checkbox" data-id="${L.gid}" ${done[L.gid] ? "checked" : ""} ${!unlocked || !all ? "disabled" : ""}>
            <span class="txt">${L.gate}</span></label>
          ${L.extra ? `<div class="extra"><b>For this type:</b> ${L.extra}</div>` : ""}
          <div class="fail">If you can't honestly tick this: ${L.fail}</div>
          ${unlocked && !all ? '<div class="hint">Finish every task above to face the gate.</div>' : ""}
        </div>
      </div></section>`;
}

function renderTypeCard(t) {
  $("typecard").innerHTML =
    `<div class="label">Your quest</div><h2>${t.name}</h2>
     <div class="row"><button class="btn" id="pick2">Change type</button></div>
     <div class="risk"><b>Where this type usually dies:</b> ${t.risk}</div>`;
  $("pick2").onclick = onChangeType;
}

export function render() {
  const t = currentType(), levels = buildLevels(t), { done, open, lastId } = state;
  renderTypeCard(t);

  let unlocked = true, current = -1, total = 0, ticked = 0;
  const html = levels.map((L) => {
    const live = L.items.filter((i) => !i.skip);
    const cnt = live.filter((i) => done[i.id]).length;
    const all = cnt === live.length;
    if (!all && done[L.gid]) done[L.gid] = false;   // un-ticking a task re-locks the gate
    total += live.length + 1;
    ticked += cnt + (done[L.gid] ? 1 : 0);
    const cleared = unlocked && done[L.gid];
    const locked = !unlocked;
    if (unlocked && !cleared && current < 0) current = L.n;
    const st = locked ? "locked" : cleared ? "cleared" : "active";
    const isOpen = open.has(L.n) || (st === "active" && !open.has("x" + L.n));
    const myUnlocked = unlocked;
    unlocked = unlocked && cleared;
    L._p = live.length ? cnt / live.length : 1;
    const just = lastId === L.gid && cleared ? "justcleared" : "";
    return levelHtml(L, { state: st, isOpen, cleared, locked, unlocked: myUnlocked, cnt, live, all, just });
  }).join("");
  $("levels").innerHTML = html;

  $("trail").innerHTML = levels.map((L) => {
    const c = L.n < current || current < 0 ? "done" : L.n === current ? "now" : "";
    return `<div class="stone ${c}" style="--p:${Math.round(L._p * 100)}%" title="Level ${L.n}"></div>`;
  }).join("");
  $("pct").textContent = Math.round((ticked / total) * 100) + "% of the quest";
  $("where").textContent = current < 0 ? "All gates cleared" : "Now on Level " + current;
  $("victory").classList.toggle("show", current < 0);
  saveProgress();
  state.lastId = null;
}

/** Wire checkbox and expand/collapse events on the level list. */
export function initQuest({ onPickType }) {
  onChangeType = onPickType;
  const levelsEl = $("levels");

  levelsEl.addEventListener("change", (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    levelsEl.classList.remove("intro");
    state.done[id] = e.target.checked;
    state.lastId = e.target.checked ? id : null;
    render();
  });

  levelsEl.addEventListener("click", (e) => {
    const tb = e.target.closest("[data-tools]");
    if (tb) {   // open/close one task's tool list without re-rendering
      const id = tb.dataset.tools, box = tb.nextElementSibling, on = !box.classList.contains("show");
      if (on) state.openTools.add(id); else state.openTools.delete(id);
      box.classList.toggle("show", on);
      tb.classList.toggle("on", on);
      tb.setAttribute("aria-expanded", on);
      return;
    }
    const b = e.target.closest("[data-toggle]");
    if (!b) return;
    levelsEl.classList.remove("intro");
    const n = +b.dataset.toggle, sec = b.parentElement;
    if (sec.classList.contains("open")) { state.open.delete(n); state.open.add("x" + n); }
    else { state.open.add(n); state.open.delete("x" + n); }
    sec.classList.toggle("open");
  });
}

export function expandAll() {
  $("levels").classList.remove("intro");
  CORE.forEach((_, n) => { state.open.add(n); state.open.delete("x" + n); });
  render();
}

/** "Show all tools" / "Hide all tools" button. */
export function initAllToolsButton() {
  const btn = $("alltools");
  const sync = () => {
    btn.textContent = state.showTools ? "Hide all tools" : "Show all tools";
    btn.setAttribute("aria-pressed", state.showTools);
  };
  btn.onclick = () => {
    setShowTools(!state.showTools);
    sync();
    $("levels").classList.remove("intro");
    render();
  };
  sync();
}

export function replayIntro() {
  $("levels").classList.add("intro");
}
