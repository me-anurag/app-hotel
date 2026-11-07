/* Entry point: wires the modules together. */
import { initScene } from "./scene.js";
import { initGrass } from "./grass.js";
import { initPaintedGrass } from "./painted-grass.js";
import { initTheme } from "./theme.js";
import { initPicker, openPicker } from "./picker.js";
import { initQuest, render, expandAll, replayIntro, initAllToolsButton } from "./quest.js";
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
initAllToolsButton();

render();

// Grass last, so the quest is interactive first: canvas meadow now, painted grass when its images load.
initGrass();
initPaintedGrass();
