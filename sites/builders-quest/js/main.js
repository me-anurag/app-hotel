/* Entry point: wires the modules together. */
import { initScene } from "./scene.js";
import { initTheme } from "./theme.js";
import { initPicker, openPicker } from "./picker.js";
import { initQuest, render, expandAll, replayIntro } from "./quest.js";
import { currentType, resetProgress } from "./state.js";

initTheme();
initScene();

initQuest({ onPickType: openPicker });
initPicker({
  onSelect() {
    replayIntro();
    render();
    document.getElementById("typecard").scrollIntoView({ behavior: "smooth", block: "start" });
  },
});

document.getElementById("reset").onclick = () => {
  if (confirm(`Reset all progress for "${currentType().name}"?`)) { resetProgress(); render(); }
};
document.getElementById("openall").onclick = expandAll;

render();
