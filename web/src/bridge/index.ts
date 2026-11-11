import { AndroidBridge, type InjectedChannel } from "./android"
import { MockBridge } from "./mock"
import type { Bridge } from "./types"

declare global {
  interface Window {
    LeoCodeAndroid?: InjectedChannel
    __leocodeThemeEvent?: (state: unknown) => void
    __leocodeBack?: () => boolean
  }
}

export type BridgeResult = { bridge: Bridge } | { error: string }

/**
 * The Android host injects `window.LeoCodeAndroid` at document start, but the
 * injection is not guaranteed before our first script runs, so on Android we poll
 * briefly. In a desktop browser we go straight to the in-memory mock.
 */
export async function createBridge(timeoutMs = 2500): Promise<BridgeResult> {
  const isAndroid = /Android/i.test(navigator.userAgent)
  if (!isAndroid) return { bridge: new MockBridge() }

  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const channel = window.LeoCodeAndroid
    if (channel && typeof channel.postMessage === "function") {
      const bridge = new AndroidBridge(channel)
      try {
        const info = await bridge.info()
        if (info?.mode === "android") return { bridge }
      } catch {
        // The host may still be starting; retry until the deadline.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return {
    error:
      "The LeoCode bridge did not attach. Reinstall the app, or update Android System WebView / Chrome and reopen."
  }
}

export { BridgeError } from "./types"
export type {
  AppInfo,
  Bridge,
  FileEntry,
  OpenFile,
  ProcessEvent,
  RunHandle,
  RuntimeInstallHandle,
  RuntimeInstallPhase,
  RuntimeInstallProgress,
  SafDocument,
  StorageInfo,
  TerminalHandle,
  ThemeMode,
  ThemeState
} from "./types"
