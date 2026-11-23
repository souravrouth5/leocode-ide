import { Suspense } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import type { AppInfo } from "../../bridge"
import { PaneError } from "../../errors/CrashScreen"
import { ErrorBoundary } from "../../errors/ErrorBoundary"
import { lazyWithRetry } from "../../errors/lazyWithRetry"
import { PythonProjectPanel } from "../python/PythonProjectPanel"

const RuntimeManager = lazyWithRetry(() =>
  import("../../components/RuntimeManager").then((module) => ({ default: module.RuntimeManager }))
)

export function RuntimesView({ info }: { info: AppInfo | null }) {
  const { bridge, shell, run, language } = useStores()
  const view = useStore(shell, (state) => state.view)
  const hasPython = useStore(language, (state) => state.languages.some((l) => l.id === "python"))

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
        {hasPython ? <PythonProjectPanel /> : null}
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
