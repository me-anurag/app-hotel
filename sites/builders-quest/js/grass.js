/* Living grass: a canvas-drawn meadow (three layers of blades, seed stalks, a few flowers)
   bending in the wind, with gusts rolling across. Colours blend between day and night.
   It is the fallback while (or if) the WebGL painted grass in painted-grass.js is unavailable. */

/** Shared with painted-grass.js: once the painted layer is showing, this canvas stops animating. */
export const grassFlags = { painted: false };

const rnd = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/* [day, night] colour pairs; layered ones are [base, tip] pairs of [day, night]. */
const C = {
  ground: ["#5e9f44", "#10271f"],
  back: [["#79b65a", "#14322b"], ["#a9d888", "#21463f"]],
  mid: [["#5a9a40", "#0f281f"], ["#98cc74", "#25514a"]],
  front: [["#468232", "#0a1c16"], ["#7fbb5c", "#1f463e"]],
  stalk: ["#9c8f55", "#3b5550"], head: ["#c9b67a", "#5d7a72"],
  flower: ["#fff6d8", "#aac3cf"], bg: ["#f2f6e9", "#0d1613"],
};
for (const k in C) C[k] = Array.isArray(C[k][0]) ? C[k].map((p) => p.map(hex)) : C[k].map(hex);

/** Colour pair p blended by m (0 = day, 1 = night). */
const col = (p, m, a = 1) => `rgba(${p[0].map((v, i) => Math.round(v + (p[1][i] - v) * m)).join(",")},${a})`;

export function initGrass() {
  const cv = document.getElementById("grass");
  const ctx = cv.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, k = 1, layers = [], stalks = [], mix = 0, target = 0, t = 0, last = 0, visible = true, raf = 0;
  let gx = -600, gv = 80, ga = .75, wait = 3;   // gust position, speed, strength, pause before next gust

  const ground = (x) => H - 24 * k - 7 * k * Math.sin(x * .0034 + .6) - 4 * k * Math.sin(x * .0091 + 2.1);
  const meadow = (x) => .5 + .6 * Math.pow(.5 + .5 * Math.sin(x * .0049 + 1.7), 1.6) * (.7 + .3 * Math.sin(x * .0017 + .4));

  function readTheme() {
    target = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--night")) || 0;
    if (still) { mix = target; draw(); }
  }

  function setup() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight; k = H / 210;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* name, clump spacing, blades per clump, clump width, height, root offset, width, flex */
    const spec = [["back", 10, 7, 16, 24, -3, 1.3, .55], ["mid", 14, 8, 22, 38, 7, 1.8, .8], ["front", 21, 7, 28, 52, 17, 2.4, 1]];
    let n = 0;
    layers = spec.map(([name, gap, per, cw, hh, off, bw, flex], li) => {
      const arr = [];
      for (let cx = -20; cx < W + 20; cx += gap * (.6 + rnd(++n) * .8)) {
        const ch = hh * k * meadow(cx + li * 137) * (.65 + rnd(++n) * .6);
        const blades = per - 2 + Math.floor(rnd(++n) * 4);
        for (let j = 0; j < blades; j++) {
          const o = rnd(++n) - .5;                  // -0.5..0.5 inside the clump
          const x = cx + o * cw * k;
          arr.push({
            x, root: ground(x) + off * k + rnd(++n) * 3 * k,
            h: ch * (1 - Math.abs(o) * .75) * (.6 + rnd(++n) * .45),
            w: bw * (.75 + rnd(++n) * .6),
            lean: o * .75 + (rnd(++n) - .5) * .18,   // fan outward like a real tuft
            seed: rnd(++n) * 6.28, flex: flex * (.75 + rnd(++n) * .5),
            flower: name === "mid" && rnd(++n) > .985,
          });
        }
      }
      return { name, arr, top: hh * k * 1.25 };
    });
    stalks = [];
    for (let x = 40 + rnd(++n) * 120; x < W; x += 170 + rnd(++n) * 260) {
      const g = 1 + Math.floor(rnd(++n) * 3);       // small groups of 1-3
      for (let j = 0; j < g; j++) {
        const sx = x + (rnd(++n) - .5) * 22 * k;
        stalks.push({
          x: sx, root: ground(sx) + (6 + rnd(++n) * 10) * k, h: (30 + rnd(++n) * 42) * k,
          lean: (rnd(++n) - .5) * .35, seed: rnd(++n) * 6.28, head: (3 + rnd(++n) * 3.5) * k + .6, a: .55 + rnd(++n) * .35,
        });
      }
    }
    draw();
  }

  function wind(x) {
    const d = (x - gx) / 320;
    return .45 * Math.sin(t * .38 + x * .0038) + .2 * Math.sin(t * .71 + x * .0105 + 1.3) + ga * Math.exp(-d * d);
  }

  function blades(L) {
    const g = ctx.createLinearGradient(0, H, 0, H - 30 * k - L.top);
    g.addColorStop(0, col(C[L.name][0], mix)); g.addColorStop(1, col(C[L.name][1], mix));
    ctx.fillStyle = g; ctx.beginPath();
    const tips = [];
    for (const b of L.arr) {
      const bend = b.lean + (wind(b.x) * .15 + .03 * Math.sin(t * 1.3 + b.seed)) * b.flex;
      const tx = b.x + bend * b.h, ty = b.root - b.h * (1 - .22 * bend * bend);
      const cx = b.x + bend * b.h * .3, cy = b.root - b.h * .55;
      ctx.moveTo(b.x - b.w / 2, b.root);
      ctx.quadraticCurveTo(cx - b.w * .22, cy, tx, ty);
      ctx.quadraticCurveTo(cx + b.w * .22, cy, b.x + b.w / 2, b.root);
      if (b.flower) tips.push([tx, ty]);
    }
    ctx.fill();
    if (tips.length) {
      ctx.fillStyle = col(C.flower, mix, .95 - .55 * mix);
      for (const [x, y] of tips) { ctx.beginPath(); ctx.arc(x, y, 2 * k + .4, 0, 6.283); ctx.fill(); }
    }
  }

  function drawStalks() {
    ctx.lineWidth = 1.1; ctx.lineCap = "round";
    for (const s of stalks) {
      ctx.strokeStyle = col(C.stalk, mix, s.a); ctx.fillStyle = col(C.head, mix, s.a);
      const bend = s.lean + wind(s.x) * .2 + .035 * Math.sin(t * .9 + s.seed);
      const tx = s.x + bend * s.h, ty = s.root - s.h * (1 - .2 * bend * bend);
      ctx.beginPath(); ctx.moveTo(s.x, s.root);
      ctx.quadraticCurveTo(s.x + bend * s.h * .25, s.root - s.h * .55, tx, ty); ctx.stroke();
      const ang = Math.atan2(ty - (s.root - s.h * .55), tx - (s.x + bend * s.h * .25));
      ctx.beginPath(); ctx.ellipse(tx, ty, s.head, 1.5 * k + .35, ang, 0, 6.283); ctx.fill();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    /* rolling ground the meadow grows from */
    ctx.fillStyle = col(C.ground, mix); ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 8) ctx.lineTo(x, ground(x) + 2 * k);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    blades(layers[0]);
    drawStalks();
    blades(layers[1]);
    blades(layers[2]);
    /* soft fade into the page */
    const f = ctx.createLinearGradient(0, H - 30 * k, 0, H);
    f.addColorStop(0, col(C.bg, mix, 0)); f.addColorStop(1, col(C.bg, mix, 1));
    ctx.fillStyle = f; ctx.fillRect(0, H - 30 * k, W, 30 * k);
  }

  function frame(now) {
    const dt = Math.min((now - (last || now)) / 1000, .05); last = now; t += dt;
    mix += (target - mix) * Math.min(1, dt * 2.6);
    if (gx > W + 600) { wait -= dt; if (wait <= 0) { gx = -600; gv = 60 + Math.random() * 50; ga = .45 + Math.random() * .55; wait = 6 + Math.random() * 8; } }
    else gx += gv * dt;
    draw();
    raf = visible && !grassFlags.painted ? requestAnimationFrame(frame) : 0;
  }

  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(setup, 120); });
  readTheme(); mix = target; setup();
  if (!still) {
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf && !grassFlags.painted) { last = 0; raf = requestAnimationFrame(frame); }
    }).observe(cv);
    raf = requestAnimationFrame(frame);
  }
}
