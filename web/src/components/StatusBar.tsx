interface Props {
  mode: "mock" | "android"
  path: string
  dirty: boolean
  message?: string | null
}

export function StatusBar({ mode, path, dirty, message }: Props) {
  return (
    <footer className="status-bar">
      <span className={"dot " + (mode === "android" ? "live" : "mock")} />
      <span className="status-path">{path === "." ? "workspace" : path}</span>
      {dirty && <span className="status-dirty">unsaved</span>}
      <span className="status-spacer" />
      {message ? (
        <span className="status-message">{message}</span>
      ) : (
        <span className="status-mode">{mode === "android" ? "device" : "preview"}</span>
      )}
    </footer>
  )
}
