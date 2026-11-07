/* Painted grass: two painted images (day and night) bent by wind in a WebGL fragment shader.
   The image strip is mirrored-tiled across the width; tall parts bend more than the roots.
   If WebGL or the images are unavailable, the canvas meadow from grass.js simply stays. */
import { grassFlags } from "./grass.js";

const DAY_SRC = "assets/grass-day.webp";
const NIGHT_SRC = "assets/grass-night.webp";

const VS = "attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}";
const FS = `precision mediump float;
varying vec2 v; uniform sampler2D dT,nT; uniform vec2 res; uniform float t,mixN,tileW,gx,ga;
uniform vec3 bgD,bgN;
void main(){
  float x=v.x*res.x, y=(1.-v.y)*res.y;
  float h=1.-y/res.y;
  float d=(x-gx)/320.;
  float w=.45*sin(t*.38+x*.0038)+.2*sin(t*.71+x*.0105+1.3)+ga*exp(-d*d);
  float fl=.35*sin(t*1.35+x*.031)+.2*sin(t*2.1+x*.067+2.);
  float bend=pow(h,1.7);
  float dx=(w*9.+fl*1.6)*bend*(res.y/250.);
  float sx=x-dx, sy=y+abs(dx)*.06*h;
  float fx=sx/tileW, tile=floor(fx), f=fract(fx);
  if(mod(tile,2.)>.5) f=1.-f;
  vec2 uv=vec2(f,clamp(sy/res.y,0.,1.));
  vec4 c=mix(texture2D(dT,uv),texture2D(nT,uv),mixN);
  vec3 bg=mix(bgD,bgN,mixN);
  float fade=smoothstep(res.y-34.,res.y,y);
  gl_FragColor=mix(c,vec4(bg,1.),fade);
}`;

export function initPaintedGrass() {
  const cv = document.getElementById("grassimg");
  const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const shader = (type, src) => {
    const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
    return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  ["dT", "nT", "res", "t", "mixN", "tileW", "gx", "ga", "bgD", "bgN"].forEach((n) => (U[n] = gl.getUniformLocation(pr, n)));
  gl.uniform3f(U.bgD, 242 / 255, 246 / 255, 233 / 255); gl.uniform3f(U.bgN, 13 / 255, 22 / 255, 19 / 255);

  let aspect = 1, W = 0, H = 0, t = 0, last = 0, mix = 0, target = 0, raf = 0, visible = true, ready = 0;
  let gx = -600, gv = 80, ga = .7, wait = 2;

  function texture(unit, src, done) {
    const im = new Image();
    im.onload = () => {
      const tx = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      aspect = im.width / im.height; done();
    };
    im.src = src;   // on error nothing happens: the canvas meadow keeps running
  }

  function readTheme() {
    target = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--night")) || 0;
    if (still && ready === 2) { mix = target; draw(); }
  }
  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    gl.viewport(0, 0, cv.width, cv.height);
  }
  function draw() {
    gl.uniform2f(U.res, W, H); gl.uniform1f(U.t, t); gl.uniform1f(U.mixN, mix);
    gl.uniform1f(U.tileW, H * aspect); gl.uniform1f(U.gx, gx); gl.uniform1f(U.ga, ga);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function frame(now) {
    const dt = Math.min((now - (last || now)) / 1000, .05); last = now; t += dt;
    mix += (target - mix) * Math.min(1, dt * 2.6);
    if (gx > W + 600) { wait -= dt; if (wait <= 0) { gx = -600; gv = 60 + Math.random() * 50; ga = .45 + Math.random() * .5; wait = 6 + Math.random() * 8; } }
    else gx += gv * dt;
    draw(); raf = visible ? requestAnimationFrame(frame) : 0;
  }
  function start() {
    if (++ready < 2) return;   // wait for both images
    gl.uniform1i(U.dT, 0); gl.uniform1i(U.nT, 1);
    size(); readTheme(); mix = target; draw();
    grassFlags.painted = true;
    document.querySelector(".scene").classList.add("painted");
    new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { size(); draw(); }, 120); });
    if (!still) {
      new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      }).observe(cv);
      raf = requestAnimationFrame(frame);
    }
  }
  texture(0, DAY_SRC, start); texture(1, NIGHT_SRC, start);
}
