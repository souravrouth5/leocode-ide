import { Suspense } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { PaneError } from "../../errors/CrashScreen"
import { ErrorBoundary } from "../../errors/ErrorBoundary"
import { lazyWithRetry } from "../../errors/lazyWithRetry"
import { useTheme } from "../../theme/ThemeProvider"

const TerminalPane = lazyWithRetry(() =>
  import("../../components/TerminalPane").then((module) => ({ default: module.TerminalPane }))
)

export function TerminalView() {
  const { bridge, files, shell, settings, errors } = useStores()
  const { effective } = useTheme()
  const view = useStore(shell, (state) => state.view)
  const cwd = useStore(files, (state) => state.cwd)
  const userSettings = useStore(settings, (state) => state.settings)
  const active = view === "terminal"

  return (
    <section
      className={"view terminal-view" + (active ? " current" : "")}
      aria-hidden={!active}
    >
      <ErrorBoundary
        fallback={(error, reset) => (
          <PaneError
            error={error}
            onRetry={reset}
            onNotice={(message) => shell.getState().flash(message)}
            title="The terminal crashed"
          />
        )}
      >
        <Suspense fallback={<div className="empty">Loading terminal…</div>}>
          <TerminalPane
            bridge={bridge}
            cwd={cwd}
            active={active}
            dark={effective === "dark"}
            fontSize={userSettings.terminalFontSize}
            fontFamily={userSettings.fontFamily}
            onError={(error) =>
              errors.getState().report(error, { context: "Reconnect the terminal" })
            }
          />
        </Suspense>
      </ErrorBoundary>
    </section>
  )
}
