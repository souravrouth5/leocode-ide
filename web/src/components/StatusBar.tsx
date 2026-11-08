interface Props {
  mode: "mock" | "android"
  cwd: string
  fileCount: number
  activePath: string | null
}

export function StatusBar({ mode, cwd, fileCount, activePath }: Props) {
  return (
    <footer className="statusbar">
      <span className="status-item">
        <span className={"dot-mode " + mode} />
        {mode === "mock" ? "mock bridge" : "android"}
      </span>
      <span className="status-item">
        {fileCount} items · /{cwd === "." ? "" : cwd}
      </span>
      <span className="status-item status-path" title={activePath ?? ""}>
        {activePath ?? "no file"}
      </span>
    </footer>
  )
}
