/* Token auth. Writes always need the token. Reads need it too unless PUBLIC_READ = "true".
   Clients send it as "Authorization: Bearer <token>" (CLI) or as the HttpOnly cookie the
   app sets via POST /api/session (so iframes and the service worker are authorised too). */
import { HttpError } from "./util.js";

const COOKIE = "sitebox";

function presented(req) {
  const h = req.headers.get("Authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get("Cookie") || "");
  return m ? decodeURIComponent(m[1]) : "";
}

export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

export function isAuthed(req, env) {
  const token = env.SITEBOX_TOKEN;
  const given = presented(req);
  return Boolean(token && given && safeEqual(given, token));
}

export const publicRead = (env) => env.PUBLIC_READ === "true";
export const canRead = (req, env) => publicRead(env) || isAuthed(req, env);

export function requireWrite(req, env) {
  if (!env.SITEBOX_TOKEN) throw new HttpError(500, "SITEBOX_TOKEN is not set. Run: npx wrangler secret put SITEBOX_TOKEN");
  if (!isAuthed(req, env)) throw new HttpError(401, "Token required");
}

export function requireRead(req, env) {
  if (!canRead(req, env)) throw new HttpError(401, "Token required");
}

export function sessionCookie(token, req) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return token
    ? `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
