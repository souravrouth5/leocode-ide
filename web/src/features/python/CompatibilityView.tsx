import { useId, useMemo, useState, useEffect } from "react"
import {
  PYTHON_COMPATIBILITY_DATA,
  type CompatiblePackage
} from "./compatibilityData"

export interface CompatibilityViewProps {
  isOpen?: boolean
  onClose?: () => void
  inline?: boolean
}

type FilterOption = "ALL" | "PASS" | "PURE" | "NATIVE" | "UNSUPPORTED"

export function CompatibilityView({
  isOpen = true,
  onClose,
  inline = false
}: CompatibilityViewProps) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<FilterOption>("ALL")
  const titleId = useId()

  useEffect(() => {
    if (!isOpen || inline || !onClose) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, inline, onClose])

  const filteredPackages = useMemo(() => {
    return PYTHON_COMPATIBILITY_DATA.packages.filter((pkg: CompatiblePackage) => {
      // Filter by type or status
      if (filter === "PASS" && pkg.overallStatus !== "PASS") return false
      if (filter === "UNSUPPORTED" && pkg.overallStatus !== "UNSUPPORTED") return false
      if (filter === "PURE" && pkg.type !== "pure") return false
      if (filter === "NATIVE" && pkg.type !== "native") return false

      // Search term
      if (search.trim()) {
        const query = search.trim().toLowerCase()
        const matchesName = pkg.name.toLowerCase().includes(query)
        const matchesNotes = pkg.notes.toLowerCase().includes(query)
        const matchesType = pkg.type.toLowerCase().includes(query)
        return matchesName || matchesNotes || matchesType
      }
      return true
    })
  }, [search, filter])

  if (!isOpen) return null

  const content = (
    <div className="compatibility-content" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Baseline Runtime Card */}
      <section className="compat-section" aria-labelledby={`${titleId}-baseline`}>
        <h3 id={`${titleId}-baseline`} className="env-heading" style={{ fontSize: "14px", marginBottom: "8px" }}>
          Python Runtime Baseline
        </h3>
        <p className="env-sub" style={{ fontSize: "12px", marginBottom: "8px" }}>
          Official python.org aarch64 build running inside the LeoCode NDK launcher on Android.
        </p>
        <div className="env-table-wrap">
          <table className="env-table" aria-label="Runtime baseline information">
            <thead>
              <tr>
                <th style={{ width: "35%" }}>Property</th>
                <th>Configuration & Details</th>
              </tr>
            </thead>
            <tbody>
              {PYTHON_COMPATIBILITY_DATA.baseline.map((item) => (
                <tr key={item.item}>
                  <td className="env-key" style={{ fontSize: "12px" }}>
                    {item.item}
                  </td>
                  <td className="env-val" style={{ fontSize: "12px" }}>
                    <code>{item.value}</code>
                    {item.detail && (
                      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                        {item.detail}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Package Compatibility Matrix */}
      <section className="compat-section" aria-labelledby={`${titleId}-packages`}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "8px"
          }}
        >
          <h3 id={`${titleId}-packages`} className="env-heading" style={{ fontSize: "14px", margin: 0 }}>
            Tested Packages ({filteredPackages.length} of {PYTHON_COMPATIBILITY_DATA.packages.length})
          </h3>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <input
              type="search"
              placeholder="Search packages..."
              aria-label="Filter packages"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                fontSize: "12px",
                padding: "4px 8px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--foreground, inherit)"
              }}
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div
          className="filter-pills"
          role="group"
          aria-label="Package category filters"
          style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" }}
        >
          {(
            [
              { key: "ALL", label: "All" },
              { key: "PASS", label: "Passing" },
              { key: "PURE", label: "Pure-Python" },
              { key: "NATIVE", label: "Native Wheels" },
              { key: "UNSUPPORTED", label: "Unsupported" }
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`btn small ${filter === tab.key ? "primary" : "ghost"}`}
              style={{ fontSize: "11px", padding: "2px 8px" }}
              aria-pressed={filter === tab.key}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="env-table-wrap">
          <table className="env-table" aria-label="Package compatibility status">
            <thead>
              <tr>
                <th>Package</th>
                <th>Type</th>
                <th>D1 (A9)</th>
                <th>D2 (A15)</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredPackages.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "16px", color: "var(--muted)" }}>
                    No packages match the current filter or search criteria.
                  </td>
                </tr>
              ) : (
                filteredPackages.map((pkg) => {
                  const statusClass =
                    pkg.overallStatus === "PASS"
                      ? "ready"
                      : pkg.overallStatus === "UNSUPPORTED"
                        ? "missing"
                        : "probing"
                  return (
                    <tr key={pkg.name}>
                      <td style={{ fontWeight: 600 }}>
                        <code>{pkg.name}</code>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: "10.5px",
                            textTransform: "uppercase",
                            padding: "2px 5px",
                            borderRadius: "4px",
                            background: "var(--surface-2)",
                            color: "var(--muted)",
                            fontWeight: 600
                          }}
                        >
                          {pkg.type}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${
                            pkg.d1Status === "PASS"
                              ? "ready"
                              : pkg.d1Status === "UNSUPPORTED"
                                ? "missing"
                                : "probing"
                          }`}
                          style={{ fontSize: "10px", padding: "2px 6px" }}
                        >
                          {pkg.d1Status}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${
                            pkg.d2Status === "PASS"
                              ? "ready"
                              : pkg.d2Status === "UNSUPPORTED"
                                ? "missing"
                                : "probing"
                          }`}
                          style={{ fontSize: "10px", padding: "2px 6px" }}
                        >
                          {pkg.d2Status}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${statusClass}`}
                          style={{ fontSize: "10.5px", padding: "2px 7px" }}
                        >
                          {pkg.overallStatus}
                        </span>
                      </td>
                      <td style={{ fontSize: "11.5px", color: "var(--muted)", maxWidth: "220px" }}>
                        {pkg.notes}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Limitations Notice */}
      <section
        className="install-notice warning"
        aria-labelledby={`${titleId}-limitations`}
        style={{ marginTop: "4px" }}
      >
        <strong id={`${titleId}-limitations`} style={{ display: "block", marginBottom: "6px" }}>
          ⚠️ Known Mobile & Android Limitations
        </strong>
        <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: "12px", lineHeight: "1.5" }}>
          {PYTHON_COMPATIBILITY_DATA.limitations.map((note, index) => (
            <li key={index} style={{ marginBottom: "4px" }}>
              {note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )

  if (inline) {
    return (
      <section
        className="env-section python-compatibility"
        aria-labelledby={`${titleId}-title`}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h2 id={`${titleId}-title`} className="env-heading">
            Python Compatibility Matrix
          </h2>
          {onClose && (
            <button
              className="btn ghost small"
              onClick={onClose}
              aria-label="Close compatibility view"
            >
              Close
            </button>
          )}
        </div>
        {content}
      </section>
    )
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${titleId}-modal-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose()
        }
      }}
    >
      <div
        className="modal-card"
        style={{ maxWidth: "720px", width: "95%", maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2 id={`${titleId}-modal-title`} className="modal-title">
            Python Compatibility Matrix
          </h2>
          {onClose && (
            <button
              className="btn ghost small"
              aria-label="Close compatibility view"
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </header>

        <div className="modal-body" style={{ overflowY: "auto" }}>
          {content}
        </div>

        <div className="modal-actions">
          {onClose && (
            <button className="btn small" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
