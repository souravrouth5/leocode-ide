import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { StoresProvider, createAppStores, type AppStores } from "./app/stores"
import { createBridge, type AppInfo, type Bridge, type ThemeState } from "./bridge"
import { LeoCodeLogo } from "./components/Icons"
import { CrashScreen } from "./errors/CrashScreen"
import { ErrorBoundary } from "./errors/ErrorBoundary"
import { createBootErrorQueue, installGlobalErrorHandlers } from "./errors/globalHandlers"
import { errorMessage, redact } from "./errors/redact"
import { simulatedError } from "./errors/simulate"
import { Shell } from "./features/shell/Shell"
import { ThemeProvider } from "./theme/ThemeProvider"

/**
 * Boot only: connect the bridge, build the store graph once, install the global
 * error handlers and render the IDE shell. Feature behaviour lives in
 * `features/*` and the stores (Task 13).
 */
export default function App() {
  useEffect(() => {
    document.getElementById("boot")?.remove()
  }, [])

  const [bridge, setBridge] = useState<Bridge | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootDetail, setBootDetail] = useState<string | null>(null)
  const stores = useMemo(() => (bridge ? createAppStores(bridge) : null), [bridge])
  const storesRef = useRef<AppStores | null>(null)
  const bootErrors = useMemo(() => createBootErrorQueue(3), [])

  useEffect(() => {
    storesRef.current = stores
  }, [stores])

  /**
   * A boot-time failure has no error store to land in yet. Keep it, and report it
   * once the stores mount; if boot never completes, `BootError` renders it (W-11).
   */
  const reportError = useCallback(
    (error: unknown, context?: string) => {
      const target = storesRef.current
      if (target) {
        target.errors.getState().report(error, { context })
        return
      }
      bootErrors.capture(error, context ?? "startup")
      setBootDetail(redact(errorMessage(error)))
    },
    [bootErrors]
  )

  useEffect(() => {
    if (!stores) return
    bootErrors.flush((error, context) => {
      stores.errors.getState().report(error, { context })
    })
  }, [stores, bootErrors])

  useEffect(() => installGlobalErrorHandlers(reportError), [reportError])

  /** Fire-and-forget bridge failures (W-23) land on the same surfaces. */
  const reportBackground = useCallback(
    (error: unknown, context: string) => {
      const target = storesRef.current
      if (target) target.errors.getState().report(error, { context })
      else bootErrors.capture(error, context)
    },
    [bootErrors]
  )

  useEffect(() => {
    if (bridge) return
    let cancelled = false
    void createBridge({
      onBackgroundError: (error, context) => reportBackground(error, context)
    }).then((result) => {
      if (cancelled) return
      if ("error" in result) setBootError(result.error)
      else setBridge(result.bridge)
    })
    return () => {
      cancelled = true
    }
  }, [bridge, reportBackground])

  return (
    <ErrorBoundary
      fallback={(error) => (
        <CrashScreen
          error={error}
          onReload={() => location.reload()}
          onNotice={(message) => {
            stores?.notifications.getState().enqueue({
              kind: "success",
              message,
              durationMs: 3_000
            })
          }}
        />
      )}
    >
      {bootError ? (
        <BootError message={redact(bootError)} detail={bootDetail} />
      ) : !stores ? (
        <Splash />
      ) : (
        <StoresProvider stores={stores}>
          <Boot stores={stores} />
        </StoresProvider>
      )}
    </ErrorBoundary>
  )
}

function Boot({ stores }: { stores: AppStores }) {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void stores.bridge
      .info()
      .then((next) => {
        if (!cancelled) setInfo(next)
      })
      .catch((error: unknown) => {
        stores.errors.getState().report(error, { context: "Read app info" })
      })
    return () => {
      cancelled = true
    }
  }, [stores])

  // `?simulate=<code>` demonstrates each error surface without breaking a real
  // operation. Mock mode only: the Android asset URL has no query string.
  useLayoutEffect(() => {
    if (stores.bridge.mode !== "mock") return
    const simulated = simulatedError()
    if (simulated) stores.errors.getState().report(simulated, { context: "simulated" })
  }, [stores])

  const theme: ThemeState | null = info?.theme ?? null
  return (
    <ThemeProvider
      bridge={stores.bridge}
      initial={theme}
      onError={(error, context) => {
        stores.errors.getState().report(error, { context })
      }}
    >
      <Shell info={info} />
    </ThemeProvider>
  )
}

function Splash() {
  return (
    <div className="splash">
      <LeoCodeLogo size={64} className="splash-logo" />
      <div className="splash-name">LeoCode</div>
      <div className="splash-note">Starting your mobile IDE…</div>
    </div>
  )
}

function BootError({ message, detail }: { message: string; detail?: string | null }) {
  return (
    <div className="splash">
      <div className="splash-mark warn">!</div>
      <div className="splash-name">Bridge unavailable</div>
      <p className="splash-note">{message}</p>
      {detail && <p className="splash-note">{detail}</p>}
    </div>
  )
}
