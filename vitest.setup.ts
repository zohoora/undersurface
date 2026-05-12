import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement matchMedia — modules that read it at import time
// (e.g. PartThoughtBubble for prefers-color-scheme) crash without this shim.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
