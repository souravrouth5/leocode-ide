/**
 * Global safety nets, Task 12. A failure that escapes React still reaches the
 * error surfaces instead of only the console.
 */
export function installGlobalErrorHandlers(
  report: (error: unknown, context?: string) => void
): () => void {
  const onError = (event: ErrorEvent) => {
    report(event.error ?? new Error(event.message), "window error")
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    report(event.reason, "unhandled promise rejection")
  }

  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}
