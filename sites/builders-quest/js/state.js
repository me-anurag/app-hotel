/* Shared, mutable quest state plus persistence helpers. */
import { storage } from "./storage.js";
import { TYPES } from "./data/types.js";

const KEY_TYPE = "bq-type";
const doneKey = (id) => "bq-done-" + id;

let initialType = storage.get(KEY_TYPE, "general");
if (!TYPES.find((t) => t.id === initialType)) initialType = "general";

export const state = {
  typeId: initialType,
  done: storage.get(doneKey(initialType), {}),
  open: new Set(),   // level numbers opened manually; "x<n>" = closed manually
  lastId: null,      // id ticked in the last change, for the pop animation
};

export const currentType = () => TYPES.find((t) => t.id === state.typeId);

export function selectType(id) {
  state.typeId = id;
  storage.set(KEY_TYPE, id);
  state.done = storage.get(doneKey(id), {});
  state.open.clear();
}

export function saveProgress() {
  storage.set(doneKey(state.typeId), state.done);
}

export function resetProgress() {
  state.done = {};
  state.open.clear();
}
