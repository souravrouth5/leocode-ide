import type { CSSProperties } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import type { BackupOperation } from "./backupStore"

const LABELS: Record<BackupOperation, string> = {
  import: "Importing a folder",
  export: "Exporting a workspace backup",
  restore: "Restoring a backup"
}

const row: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "5px 12px",
  background: "var(--surface-2)",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-dim)",
  fontSize: "11.5px",
  minWidth: 0
}

const label: CSSProperties = {
  color: "var(--text)",
  fontWeight: 600,
  flex: "0 0 auto"
}

const statusText: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0
}

const note: CSSProperties = {
  marginLeft: "auto",
  flex: "0 0 auto",
  opacity: 0.75
}

/**
 * Persistent import/export/restore row (PD-25). The SAF work keeps running when
 * the Settings sheet closes; this is the only thing that says so. There is no
 * cancel button because the host exposes no cancellation for these operations.
 */
export function BackupProgressBanner() {
  const { backup } = useStores()
  const busy = useStore(backup, (state) => state.busy)
  const operation = useStore(backup, (state) => state.operation)
  const status = useStore(backup, (state) => state.status)
  if (!busy) return null

  return (
    <div className="backup-progress" role="status" aria-live="polite" style={row}>
      <span className="dot live" aria-hidden="true" />
      <span style={label}>{operation ? LABELS[operation] : "Working"}</span>
      {status && <span style={statusText}>{status}</span>}
      <span style={note}>Continues if Settings is closed</span>
    </div>
  )
}
