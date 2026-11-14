import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import { StoresProvider, createAppStores, type AppStores } from "./app/stores"
import { createBridge, type AppInfo, type Bridge, type ThemeState } from "./bridge"
import { LeoCodeLogo } from "./components/Icons"
import { CrashScreen } from "./errors/CrashScreen"
import { ErrorBoundary } from "./errors/ErrorBoundary"
import { installGlobalErrorHandlers } from "./errors/globalHandlers"
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
  const stores = useMemo(() => (bridge ? createAppStores(bridge) : null), [bridge])

  useEffect(
    () =>
      installGlobalErrorHandlers((error, context) => {
        if (stores) stores.errors.getState().report(error, { context })
      }),
    [stores]
  )

  useEffect(() => {
    if (bridge) return
    let cancelled = false
    void createBridge().then((result) => {
      if (cancelled) return
      if ("error" in result) setBootError(result.error)
      else setBridge(result.bridge)
    })
    return () => {
      cancelled = true
    }
  }, [bridge])

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
        <BootError message={bootError} />
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
    <ThemeProvider bridge={stores.bridge} initial={theme}>
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

function BootError({ message }: { message: string }) {
  return (
    <div className="splash">
      <div className="splash-mark warn">!</div>
      <div className="splash-name">Bridge unavailable</div>
      <p className="splash-note">{message}</p>
    </div>
  )
}
