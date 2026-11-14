import type { ReactNode } from "react"
import { PaneError } from "./CrashScreen"
import { ErrorBoundary } from "./ErrorBoundary"

/**
 * Per-pane containment (W-29): a render crash in one pane shows `PaneError`
 * there and leaves the rest of the IDE working, instead of reaching the app
 * boundary and replacing everything with `CrashScreen`.
 */
export function PaneBoundary({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => <PaneError error={error} onRetry={reset} title={title} />}
    >
      {children}
    </ErrorBoundary>
  )
}
