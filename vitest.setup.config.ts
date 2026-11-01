// Node 25+ exposes a native `localStorage` global that is unusable without
// --localstorage-file and shadows the jsdom implementation. Restore jsdom's.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom
  ?.window;
if (jsdomWindow && typeof globalThis.localStorage?.setItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: jsdomWindow.localStorage,
  });
}
