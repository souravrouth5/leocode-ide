import { MockBridge } from "./mock"
import type { Bridge } from "./types"

declare global {
  interface Window {
    __LEOCODE_BRIDGE__?: Bridge
  }
}

/**
 * The Android host injects a bridge before the app boots (Phase 1).
 * Until then, the browser runs against the in-memory mock.
 */
export function createBridge(): Bridge {
  return window.__LEOCODE_BRIDGE__ ?? new MockBridge()
}

export type { AppInfo, Bridge, FileEntry, OpenFile, ProcessEvent } from "./types"
