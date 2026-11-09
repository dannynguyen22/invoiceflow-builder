import "@testing-library/jest-dom/vitest";

// jsdom here is not backed by a real localStorage (Node runs without --localstorage-file),
// so `window.localStorage` can be undefined. Provide an in-memory implementation so code
// and tests that persist locale/layout preferences behave like a browser.
if (!("localStorage" in window) || window.localStorage == null) {
  const store = new Map<string, string>();
  const mem: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };
  Object.defineProperty(window, "localStorage", { writable: true, configurable: true, value: mem });
}

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in window)) Object.defineProperty(window, "ResizeObserver", { writable: true, value: RO });
