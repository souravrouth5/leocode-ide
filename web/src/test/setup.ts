// jsdom does not implement the matchMedia API the theme store uses.
if (!window.matchMedia) {
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
      dispatchEvent: () => false
    })
  })
}

// xterm and the layout code use ResizeObserver; jsdom has no implementation.
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverStub
  })
}

// CodeMirror measures the caret with Range.getClientRects, which jsdom lacks.
// The editor still renders; without the stub every measure logs a TypeError.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  const emptyRect = new DOMRect(0, 0, 0, 0)
  Range.prototype.getClientRects = function getClientRects() {
    return Object.assign([], { item: () => null }) as unknown as DOMRectList
  }
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return emptyRect
  }
}
