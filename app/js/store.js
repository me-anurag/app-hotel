/* App state: the list of sites, with subscribers re-rendering on change. */
import { api } from "./api.js";

const listeners = new Set();
export const state = { sites: [], loaded: false, online: navigator.onLine, error: "" };

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((fn) => fn(state));

export async function refresh() {
  try {
    state.sites = await api.list();
    state.error = "";
  } catch (e) {
    state.error = e.message;
  }
  state.loaded = true;
  emit();
  return state.sites;
}

export function setOnline(v) {
  if (state.online === v) return;
  state.online = v;
  emit();
}

export const findSite = (slug) => state.sites.find((s) => s.slug === slug);
