import { Sheet } from "../../components/Sheet"
import { AlertTriangleIcon } from "../../components/Icons"

interface RootWarningDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
}

export function RootWarningDialog({
  open,
  onClose,
  onConfirm,
  loading = false
}: RootWarningDialogProps) {
  if (!open) return null
  return (
    <Sheet open={open} onClose={onClose} title="Enable Root Mode" className="root-warning-sheet">
      <div className="root-warning-content" style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--color-bg-card)", padding: 16, borderRadius: 8, border: "1px solid var(--color-danger, #ef4444)" }}>
          <AlertTriangleIcon size={24} color="var(--color-danger, #ef4444)" />
          <div>
            <h3 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 600, color: "var(--color-danger, #ef4444)" }}>
              High-Privilege Warning
            </h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--color-fg-muted)" }}>
              Root Mode allows terminal sessions and run processes to execute with unrestricted superuser privileges (UID 0 / root).
              Root processes can modify system partitions, inspect other apps' data, and potentially cause device instability.
            </p>
          </div>
        </div>

        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--color-fg-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
          <li>A superuser permission prompt will appear from your root manager (e.g. Magisk).</li>
          <li>A prominent <strong>ROOT</strong> badge will be displayed while active.</li>
          <li>You can disable Root Mode anytime in Settings › Advanced.</li>
        </ul>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
          <button
            className="secondary-btn"
            onClick={onClose}
            disabled={loading}
            style={{ padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            className="primary-btn"
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              background: "var(--color-danger, #ef4444)",
              color: "#fff",
              border: "none",
              cursor: loading ? "wait" : "pointer"
            }}
          >
            {loading ? "Requesting..." : "Enable Root Mode"}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
