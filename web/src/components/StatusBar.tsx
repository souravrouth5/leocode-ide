interface Props {
  mode: "mock" | "android"
  path: string
  dirty: boolean
  message?: string | null
  rootActive?: boolean
}

export function StatusBar({ mode, path, dirty, message, rootActive }: Props) {
  return (
    <footer className="status-bar">
      <span className={"dot " + (mode === "android" ? "live" : "mock")} />
      {rootActive && (
        <span
          className="badge root-badge"
          title="Root process active (UID 0)"
          style={{
            fontSize: 10,
            fontWeight: 700,
            background: "var(--color-danger, #ef4444)",
            color: "#ffffff",
            padding: "2px 5px",
            borderRadius: 3,
            letterSpacing: 0.5,
            marginRight: 6
          }}
        >
          # ROOT
        </span>
      )}
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
