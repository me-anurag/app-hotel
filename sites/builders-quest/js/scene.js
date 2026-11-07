/* Generates the decorative header scene: stars, clouds and fireflies (grass lives in grass.js / painted-grass.js).
   Uses a seeded pseudo-random function so the layout is identical on every load. */
const rnd = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

function makeStars(el) {
  for (let i = 0, made = 0; i < 200 && made < 80; i++) {
    const L = rnd(i) * 100, top = rnd(i + 100) * 100;
    if (L < 66 && top > 22 && top < 92) continue;   // keep the text area clean
    made++;
    const s = document.createElement("span");
    s.className = "star";
    const z = 1 + rnd(i + 3) * 1.8;
    s.style.cssText = `left:${L}%;top:${top}%;width:${z}px;height:${z}px;--d:${2 + rnd(i + 7) * 4}s;--dl:${-rnd(i + 9) * 5}s`;
    el.appendChild(s);
  }
}

function makeClouds(el) {
  [[4, .55, 130, -20], [60, .85, 100, -60], [67, .6, 120, -15], [56, .5, 150, -95]].forEach(([top, sc, d, dl]) => {
    const c = document.createElement("div");
    c.className = "cloud";
    c.style.cssText = `top:${top}%;--s:${sc};--d:${d}s;--dl:${dl}s`;
    el.appendChild(c);
  });
}

function makeFireflies(el) {
  for (let i = 0; i < 16; i++) {
    const f = document.createElement("span");
    f.className = "fly";
    f.style.cssText = `left:${rnd(i + 200) * 100}%;bottom:${20 + rnd(i + 300) * 200}px;--dx:${(rnd(i + 400) - .5) * 70}px;--dy:${(rnd(i + 500) - .5) * 50}px;--d:${11 + rnd(i + 600) * 10}s;--b:${3.5 + rnd(i + 700) * 4}s;--dl:${-rnd(i + 800) * 8}s`;
    el.appendChild(f);
  }
}

export function initScene() {
  makeStars(document.getElementById("stars"));
  makeClouds(document.getElementById("clouds"));
  makeFireflies(document.getElementById("flies"));
}
