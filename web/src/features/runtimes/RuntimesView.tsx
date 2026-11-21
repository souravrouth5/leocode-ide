import { Suspense } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import type { AppInfo } from "../../bridge"
import { PaneError } from "../../errors/CrashScreen"
import { ErrorBoundary } from "../../errors/ErrorBoundary"
import { lazyWithRetry } from "../../errors/lazyWithRetry"

const RuntimeManager = lazyWithRetry(() =>
  import("../../components/RuntimeManager").then((module) => ({ default: module.RuntimeManager }))
)

export function RuntimesView({ info }: { info: AppInfo | null }) {
  const { bridge, shell, run } = useStores()
  const view = useStore(shell, (state) => state.view)

  return (
    <section
      className={"view runtimes-view" + (view === "runtimes" ? " current" : "")}
      aria-hidden={view !== "runtimes"}
    >
      <ErrorBoundary
        fallback={(error, reset) => (
          <PaneError
            error={error}
            onRetry={reset}
            onNotice={(message) => shell.getState().flash(message)}
            title="The runtime list crashed"
          />
        )}
      >
        <Suspense fallback={<div className="empty">Loading runtimes…</div>}>
          <RuntimeManager
            bridge={bridge}
            info={info}
            onOpenTerminal={() => shell.getState().go("terminal")}
            onRuntimeInstalled={() => run.getState().invalidatePythonProbe()}
          />
        </Suspense>
      </ErrorBoundary>
    </section>
  )
}
