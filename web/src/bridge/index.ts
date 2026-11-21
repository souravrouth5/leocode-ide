import { AndroidBridge, type InjectedChannel } from "./android"
import { MockBridge } from "./mock"
import type { AppError, Bridge } from "./types"

declare global {
  interface Window {
    LeoCodeAndroid?: InjectedChannel
    __leocodeThemeEvent?: (state: unknown) => void
    __leocodeBack?: () => boolean
  }
}

export type BridgeResult = { bridge: Bridge } | { error: string }

export interface CreateBridgeOptions {
  /**
   * Fire-and-forget failures (terminal input, acks, cancels) are reported here
   * once per burst (W-23). Wired to the errors store by `App`.
   */
  onBackgroundError?: (error: AppError, context: string) => void
}

function injectedChannel(): InjectedChannel | null {
  const channel = window.LeoCodeAndroid
  if (channel && typeof channel.postMessage === "function") return channel
  return null
}

/** Host pages are served from the WebView asset loader; a browser never is. */
function isHostOrigin(): boolean {
  return (
    location.protocol === "https:" && location.hostname === "appassets.androidplatform.net"
  )
}

async function waitForChannel(): Promise<InjectedChannel | null> {
  const channel = injectedChannel()
  if (channel) return channel
  // addWebMessageListener injects at document start, before our module runs. If
  // it is still missing at `load`, this is a browser or a broken host.
  if (document.readyState !== "complete") {
    await new Promise<void>((resolve) => {
      window.addEventListener("load", () => resolve(), { once: true })
    })
  }
  return injectedChannel()
}

/**
 * Android is detected by the injected channel, never by the user agent (Task 11).
 * A browser falls back to the in-memory mock; a host page without a channel is a
 * real start-up failure and says so.
 */
export async function createBridge(
  options: CreateBridgeOptions = {}
): Promise<BridgeResult> {
  const channel = await waitForChannel()
  if (!channel) {
    if (isHostOrigin()) {
      return {
        error:
          "The LeoCode bridge did not attach. Reinstall the app, or update Android System WebView / Chrome and reopen."
      }
    }
    return { bridge: new MockBridge() }
  }

  const bridge = new AndroidBridge(channel, {
    onBackgroundError: options.onBackgroundError
  })
  try {
    // A handshake, not a user request: a dead host should not delay the boot for 10 s.
    const info = await bridge.info({ timeoutMs: 2_000 })
    if (info?.mode === "android") return { bridge }
    return { error: "The LeoCode bridge answered with an unexpected mode." }
  } catch (error) {
    return {
      error: `The LeoCode bridge did not answer: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

export { AppError, BridgeError } from "./types"
export type {
  AppInfo,
  BackupResult,
  Bridge,
  Draft,
  DraftInfo,
  FileEntry,
  FileStat,
  GitAuth,
  GitBranch,
  GitBranchList,
  GitBranchRequest,
  GitCheckoutRequest,
  GitCloneRequest,
  GitCommitEntry,
  GitCommitRequest,
  GitCommitResult,
  GitConflict,
  GitDiff,
  GitDiffRequest,
  GitFileChange,
  GitInitRequest,
  GitLogRequest,
  GitPathsRequest,
  GitProgress,
  GitRemote,
  GitRemoteList,
  GitRemoteSetRequest,
  GitResolveRequest,
  GitResolveStrategy,
  GitStatus,
  GitStream,
  GitSyncRequest,
  GitSyncResult,
  OpenFile,
  ProcessEvent,
  ReadChunk,
  RequestOptions,
  RunHandle,
  RuntimeCatalogEntry,
  RuntimeInstallHandle,
  RuntimeInstallPhase,
  RuntimeInstallProgress,
  SafDocument,
  SafExportResult,
  SafProgress,
  SafProgressPhase,
  SearchMatch,
  SearchOptions,
  SearchSummary,
  SecretSetRequest,
  SshHostAnswerRequest,
  SshHostPrompt,
  SshKey,
  SshKeyGenerateRequest,
  SshKeyIdRequest,
  SshKeyImportRequest,
  SshKnownHost,
  SshKnownHostDeleteRequest,
  StorageInfo,
  TerminalAttach,
  TerminalAttachOptions,
  TerminalHandle,
  TerminalInfo,
  ThemeMode,
  ThemeState,
  TreeImportResult,
  WorkspaceInfo,
  WorkspaceList,
  WorkspaceRef,
  WriteResult
} from "./types"
