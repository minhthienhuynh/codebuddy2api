import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vite-plus/test";
import { clearToasts } from "./toast";
window.scrollTo = vi.fn();
if (!window.PointerEvent) window.PointerEvent = MouseEvent as typeof PointerEvent;

// Node 22 defines an experimental globalThis.localStorage that throws in jsdom without --localstorage-file.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, String(value)),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
};
try {
  Object.defineProperty(window, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
} catch {
  /* ignore */
}

afterEach(() => {
  cleanup();
  clearToasts();
});
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
