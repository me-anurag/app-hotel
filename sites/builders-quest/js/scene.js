/* Generates the decorative header scene: stars, clouds, fireflies, grass and flowers.
   Uses a seeded pseudo-random function so the layout is identical on every load. */
const NS = "http://www.w3.org/2000/svg";
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
  for (let i = 0; i < 24; i++) {
    const f = document.createElement("span");
    f.className = "fly";
    f.style.cssText = `left:${rnd(i + 200) * 100}%;bottom:${20 + rnd(i + 300) * 200}px;--dx:${(rnd(i + 400) - .5) * 90}px;--dy:${(rnd(i + 500) - .5) * 70}px;--d:${6 + rnd(i + 600) * 8}s;--b:${2 + rnd(i + 700) * 3}s;--dl:${-rnd(i + 800) * 8}s`;
    el.appendChild(f);
  }
}

function makeGrass() {
  const d = ["", "", ""];
  for (let x = 4, i = 0; x < 1440; x += 8, i++) {
    const h = 16 + rnd(i + 900) * 24, l = (rnd(i + 1000) - .5) * 10, base = 200;
    d[i % 3] += `M${(x - 2.6).toFixed(1)} ${base} Q${(x + l * .4).toFixed(1)} ${(base - h * .6).toFixed(1)} ${(x + l).toFixed(1)} ${(base - h).toFixed(1)} Q${(x + 1).toFixed(1)} ${(base - h * .5).toFixed(1)} ${(x + 2.6).toFixed(1)} ${base}Z`;
  }
  ["s1", "s2", "s3"].forEach((id, k) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d[k]);
    document.getElementById(id).appendChild(p);
  });
  const g1 = document.getElementById("s1");
  for (let j = 0; j < 26; j++) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", (rnd(j + 1200) * 1440).toFixed(1));
    c.setAttribute("cy", (178 + rnd(j + 1300) * 10).toFixed(1));
    c.setAttribute("r", (2 + rnd(j + 1400) * 1.4).toFixed(1));
    c.setAttribute("fill", "var(--flower)");
    g1.appendChild(c);
  }
}

export function initScene() {
  makeStars(document.getElementById("stars"));
  makeClouds(document.getElementById("clouds"));
  makeFireflies(document.getElementById("flies"));
  makeGrass();
}
