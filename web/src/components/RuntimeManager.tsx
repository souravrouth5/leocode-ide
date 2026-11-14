import { useCallback, useEffect, useRef, useState } from "react"
import { BridgeError, type AppInfo, type Bridge, type RuntimeInstallProgress } from "../bridge"
import { redact } from "../errors/redact"
import { CheckIcon, CpuIcon, RefreshIcon, TerminalIcon, XIcon } from "./Icons"

interface Props {
  bridge: Bridge
  info: AppInfo | null
  onOpenTerminal?: () => void
}

export type RuntimeStatus = "ready" | "installed" | "missing" | "probing" | "error"

export interface RuntimeCardData {
  id: string
  name: string
  category: string
  status: RuntimeStatus
  version?: string
  subVersion?: string
  path: string
  description: string
  guidance: string
  envVars?: Record<string, string>
  checkCommands: {
    primary: string[]
    secondary?: string[]
  }
}

interface EnvState {
  PATH: string
  HOME: string
  PYTHONHOME: string
  JAVA_HOME: string
  TMPDIR: string
}

const DEFAULT_RUNTIMES: RuntimeCardData[] = [
  {
    id: "python",
    name: "Python 3",
    category: "Phase 0 / Phase 4",
    status: "probing",
    path: "/data/data/dev.leocode/files/usr/bin/python3",
    description: "CPython 3.14.10 from python.org, built for Android arm64-v8a.",
    guidance:
      "Installed on demand. Includes the full standard library, pip, SQLite, zlib and OpenSSL with a bundled CA file. Native PyPI wheels that target manylinux/musllinux will not load on Android; pure-Python packages work.",
    envVars: {
      PYTHONHOME: "/data/data/dev.leocode/files/usr",
      LD_LIBRARY_PATH: "/data/data/dev.leocode/files/usr/lib",
      SSL_CERT_FILE: "/data/data/dev.leocode/files/usr/etc/ca-certificates.pem"
    },
    checkCommands: {
      primary: ["python3", "--version"],
      secondary: ["python3", "-m", "pip", "--version"]
    }
  },
  {
    id: "node",
    name: "Node.js & npm",
    category: "Phase 5",
    status: "probing",
    path: "/data/data/dev.leocode/files/usr/bin/node",
    description: "JavaScript / TypeScript runtime for local tooling and dev servers.",
    guidance:
      "V8-based Node.js LTS engine. Allows running npm scripts, Vite, and Node servers bound to localhost.",
    envVars: {
      NODE_PATH: "/data/data/dev.leocode/files/usr/lib/node_modules"
    },
    checkCommands: {
      primary: ["node", "--version"],
      secondary: ["npm", "--version"]
    }
  },
  {
    id: "java",
    name: "Java / OpenJDK",
    category: "Phase 6",
    status: "probing",
    path: "/data/data/dev.leocode/files/usr/lib/jvm",
    description: "OpenJDK Headless Runtime for compilation and execution.",
    guidance:
      "Supports javac, java, and jar execution on device without root. Configured via JAVA_HOME.",
    envVars: {
      JAVA_HOME: "/data/data/dev.leocode/files/usr/lib/jvm"
    },
    checkCommands: {
      primary: ["java", "-version"]
    }
  },
  {
    id: "toolchain",
    name: "C / C++ Toolchain",
    category: "Phase 0 Native",
    status: "probing",
    path: "/data/data/dev.leocode/files/usr/bin/clang",
    description: "Clang, GCC, and GNU Make compiler toolchain.",
    guidance:
      "Enables building native C/C++ packages and compiling Python C-extension wheels directly on device.",
    checkCommands: {
      primary: ["clang", "--version"],
      secondary: ["make", "--version"]
    }
  },
  {
    id: "shell",
    name: "Shell & Coreutils",
    category: "System Ready",
    status: "ready",
    path: "/system/bin/sh",
    description: "Android system POSIX shell and Toybox/Toolbox core utilities.",
    guidance:
      "Built-in Android system shell with POSIX core utilities. Always available and sandboxed within app storage.",
    checkCommands: {
      primary: ["/system/bin/sh", "-c", "echo $SHELL; toybox --version 2>&1 || true"]
    }
  }
]

const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing",
  download: "Downloading",
  verify: "Verifying",
  extract: "Extracting",
  configure: "Configuring",
  health: "Health check",
  done: "Done"
}

const INSTALL_DETAILS: Record<string, { version: string; download: string; disk: string }> = {
  python: { version: "3.14.10", download: "22 MB", disk: "~45 MB" }
}

function installErrorHint(code: string, message: string): string {
  switch (code) {
    case "E_OFFLINE":
      return "The package could not be downloaded. Check the connection and retry; an interrupted download resumes where it stopped."
    case "E_DISK_FULL":
      return `${message} Free up space, then retry.`
    case "E_INTEGRITY":
      return "The downloaded package did not match its pinned checksum and was discarded. Retry the install."
    case "E_HEALTH_CHECK":
      return `${message} The runtime was not activated; retry the install.`
    case "E_TIMEOUT":
      return `${message} Retry when the device is idle.`
    default:
      return message
  }
}

export function RuntimeManager({ bridge, info, onOpenTerminal }: Props) {
  const [runtimes, setRuntimes] = useState<RuntimeCardData[]>(DEFAULT_RUNTIMES)
  const [env, setEnv] = useState<EnvState>({
    PATH: "/data/data/dev.leocode/files/usr/bin:/system/bin:/system/xbin",
    HOME: "/data/data/dev.leocode/files/home",
    PYTHONHOME: "(not set)",
    JAVA_HOME: "(not set)",
    TMPDIR: "/data/data/dev.leocode/files/tmp"
  })
  const [probing, setProbing] = useState(false)
  const [lastProbed, setLastProbed] = useState<Date | null>(null)
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeCardData | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [progress, setProgress] = useState<RuntimeInstallProgress | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<{ code: string; message: string } | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const closeModal = () => {
    if (installing) return
    setSelectedRuntime(null)
    setProgress(null)
    setInstallError(null)
  }

  const probeAll = useCallback(async () => {
    setProbing(true)
    setProbeError(null)
    const updated = [...DEFAULT_RUNTIMES]
    let failed = 0

    // Probe environment variables
    try {
      let envOutput = ""
      await bridge.run(
        [
          "/system/bin/sh",
          "-c",
          "echo PATH=$PATH; echo HOME=$HOME; echo PYTHONHOME=$PYTHONHOME; echo JAVA_HOME=$JAVA_HOME; echo TMPDIR=$TMPDIR"
        ],
        ".",
        (event) => {
          envOutput += event.data
        }
      )
      const parsed: Partial<EnvState> = {}
      for (const line of envOutput.split("\n")) {
        const [k, ...v] = line.split("=")
        if (k && v.length > 0) {
          const val = v.join("=").trim()
          parsed[k.trim() as keyof EnvState] = val.length > 0 ? val : "(not set)"
        }
      }
      setEnv((prev) => ({
        ...prev,
        ...parsed
      }))
    } catch {
      // In mock or constrained environment, keep defaults
    }

    // Probe each runtime
    for (let i = 0; i < updated.length; i++) {
      const item = { ...updated[i] }
      if (item.id === "shell") {
        item.status = "ready"
        item.version = "Android sh / Toybox"
        updated[i] = item
        continue
      }

      try {
        let stdout = ""
        let stderr = ""
        const code = await bridge.run(item.checkCommands.primary, ".", (event) => {
          if (event.stream === "stdout") stdout += event.data
          else stderr += event.data
        })

        const combined = (stdout + "\n" + stderr).trim()
        if (code === 0 && combined.length > 0) {
          item.status = "installed"
          item.version = combined.split("\n")[0]

          // Optional secondary check (e.g. pip, npm, make)
          if (item.checkCommands.secondary) {
            let secOut = ""
            const secCode = await bridge.run(item.checkCommands.secondary, ".", (ev) => {
              secOut += ev.data
            })
            if (secCode === 0 && secOut.trim().length > 0) {
              item.subVersion = secOut.trim().split("\n")[0]
            }
          }
        } else {
          item.status = "missing"
          item.version = undefined
        }
      } catch (err) {
        // A missing binary makes ProcessBuilder.start() fail with E_IO. Any other
        // error is the bridge itself failing, which must not look like "not installed".
        if (err instanceof BridgeError && (err.code === "E_IO" || err.code === "E_NOT_FOUND")) {
          item.status = "missing"
        } else {
          item.status = "error"
          failed += 1
        }
        item.version = undefined
      }
      updated[i] = item
    }

    setRuntimes(updated)
    setLastProbed(new Date())
    setProbeError(
      failed > 0
        ? `Couldn't check ${failed} runtime${failed === 1 ? "" : "s"}. The bridge did not answer; the list may be incomplete.`
        : null
    )
    setProbing(false)
  }, [bridge])

  useEffect(() => {
    void probeAll()
  }, [probeAll])

  const triggerInstall = (rt: RuntimeCardData) => {
    setSelectedRuntime(rt)
    setProgress(null)
    setInstallError(null)
  }

  const startInstall = async () => {
    const rt = selectedRuntime
    if (!rt || !bridge.installRuntime) return

    setInstalling(true)
    setInstallError(null)
    setProgress({ phase: "preparing", bytes: 0, total: 0, message: "Starting…" })

    try {
      await bridge.installRuntime(
        rt.id,
        (next) => setProgress(next),
        (handle) => {
          cancelRef.current = handle.cancel
        }
      )
      setProgress({ phase: "done", bytes: 0, total: 0, message: `${rt.name} installed` })
      await probeAll()
    } catch (err) {
      const code = err instanceof BridgeError ? err.code : "E_INTERNAL"
      if (code === "E_CANCELLED") {
        setProgress(null)
      } else {
        setInstallError({
          code,
          message: err instanceof Error ? err.message : "installation failed"
        })
        setProgress(null)
      }
    } finally {
      setInstalling(false)
      cancelRef.current = null
    }
  }

  const cancelInstall = () => {
    cancelRef.current?.()
  }

  const isPython = selectedRuntime?.id === "python"
  const details = selectedRuntime ? INSTALL_DETAILS[selectedRuntime.id] : undefined
  const installedNow = progress?.phase === "done"
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.max(0, Math.round((progress.bytes / progress.total) * 100)))
      : null

  return (
    <div className="runtime-manager">
      <header className="runtime-header">
        <div className="runtime-title-group">
          <div className="runtime-icon-badge">
            <CpuIcon size={24} />
          </div>
          <div>
            <h2 className="runtime-heading">Runtime Environments</h2>
            <p className="runtime-sub">
              Manage Python, Node.js, toolchains, and execution environments on device.
            </p>
          </div>
        </div>
        <button
          className={"btn btn-primary" + (probing ? " loading" : "")}
          onClick={() => void probeAll()}
          disabled={probing}
        >
          <RefreshIcon size={16} className={probing ? "spin" : undefined} />
          <span>{probing ? "Probing…" : "Probe Runtimes"}</span>
        </button>
      </header>

      {lastProbed && (
        <div className="probe-timestamp">
          Last checked: {lastProbed.toLocaleTimeString()} · Mode: {info?.mode ?? "host"}
        </div>
      )}

      {probeError && (
        <div className="probe-error" role="alert">
          <span>{probeError}</span>
          <button className="btn ghost small" onClick={() => void probeAll()} disabled={probing}>
            Retry
          </button>
        </div>
      )}

      {/* Runtimes Grid */}
      <section className="runtime-cards">
        {runtimes.map((rt) => {
          const isReady = rt.status === "ready" || rt.status === "installed"
          return (
            <article key={rt.id} className={"runtime-card " + rt.status}>
              <div className="runtime-card-top">
                <div className="runtime-name-wrap">
                  <h3 className="runtime-name">{rt.name}</h3>
                  <span className="runtime-category">{rt.category}</span>
                </div>
                <span
                  className={
                    "status-badge " +
                    (isReady
                      ? "ready"
                      : rt.status === "probing"
                        ? "probing"
                        : rt.status === "error"
                          ? "error"
                          : "missing")
                  }
                >
                  {isReady ? (
                    <>
                      <CheckIcon size={13} />
                      {rt.status === "ready" ? "Ready" : "Installed"}
                    </>
                  ) : rt.status === "probing" ? (
                    "Checking…"
                  ) : rt.status === "error" ? (
                    "Check failed"
                  ) : (
                    <>
                      <XIcon size={13} />
                      Not Installed
                    </>
                  )}
                </span>
              </div>

              <div className="runtime-path">
                <code>{rt.path}</code>
              </div>

              {rt.version && (
                <div className="runtime-version-info">
                  <div className="version-pill primary">{rt.version}</div>
                  {rt.subVersion && <div className="version-pill secondary">{rt.subVersion}</div>}
                </div>
              )}

              <p className="runtime-desc">{rt.description}</p>

              <div className="runtime-card-actions">
                {isReady ? (
                  <button
                    className="btn ghost small"
                    onClick={onOpenTerminal}
                    title="Open interactive terminal"
                  >
                    <TerminalIcon size={14} />
                    <span>Launch in Shell</span>
                  </button>
                ) : (
                  <button
                    className={"btn primary small" + (installing && selectedRuntime?.id === rt.id ? " loading" : "")}
                    onClick={() => triggerInstall(rt)}
                    disabled={installing}
                    title={
                      rt.id === "python"
                        ? "Download and install Python 3.14.10"
                        : "See what this runtime needs"
                    }
                  >
                    <span>
                      {installing && selectedRuntime?.id === rt.id
                        ? "Installing…"
                        : rt.id === "python"
                          ? "Install"
                          : "Setup info"}
                    </span>
                  </button>
                )}
                <button
                  className="btn ghost small"
                  onClick={() => {
                    setProgress(null)
                    setInstallError(null)
                    setSelectedRuntime(rt)
                  }}
                >
                  Details
                </button>
              </div>
            </article>
          )
        })}
      </section>

      {/* Environment Variables Section */}
      <section className="env-section">
        <h3 className="env-heading">Runtime Environment Variables</h3>
        <p className="env-sub">Inherited by child processes, PTY shells, and run sessions:</p>
        <div className="env-table-wrap">
          <table className="env-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="env-key">PATH</td>
                <td className="env-val"><code>{env.PATH}</code></td>
              </tr>
              <tr>
                <td className="env-key">HOME</td>
                <td className="env-val"><code>{env.HOME}</code></td>
              </tr>
              <tr>
                <td className="env-key">PYTHONHOME</td>
                <td className="env-val"><code>{env.PYTHONHOME}</code></td>
              </tr>
              <tr>
                <td className="env-key">JAVA_HOME</td>
                <td className="env-val"><code>{env.JAVA_HOME}</code></td>
              </tr>
              <tr>
                <td className="env-key">TMPDIR</td>
                <td className="env-val"><code>{env.TMPDIR}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Runtime Detail / Setup Modal Dialog */}
      {selectedRuntime && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">{selectedRuntime.name} Details</h3>
              <button
                className="icon-btn small"
                onClick={closeModal}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <span className="field-label">Status</span>
                <span className={"status-badge " + (installedNow || selectedRuntime.status === "ready" || selectedRuntime.status === "installed" ? "ready" : "missing")}>
                  {installedNow
                    ? "INSTALLED"
                    : selectedRuntime.status.toUpperCase()}
                </span>
              </div>
              <div className="modal-field">
                <span className="field-label">Target Binary Path</span>
                <code>{selectedRuntime.path}</code>
              </div>
              <div className="modal-field">
                <span className="field-label">Guidance</span>
                <p>{selectedRuntime.guidance}</p>
              </div>

              {selectedRuntime.envVars && (
                <div className="modal-field">
                  <span className="field-label">Runtime Variables</span>
                  <div className="env-chips">
                    {Object.entries(selectedRuntime.envVars).map(([k, v]) => (
                      <div key={k} className="env-chip">
                        <strong>{k}:</strong> <code>{v}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {installedNow && (
                <div className="install-notice success" role="status">
                  <strong>Installed</strong>
                  <p>
                    {details
                      ? `Python ${details.version} is ready.`
                      : `${selectedRuntime.name} is ready.`}{" "}
                    {isPython && (
                      <>
                        Run <code>python3 --version</code>, <code>pip --version</code>, or open the
                        terminal to use it.
                      </>
                    )}
                  </p>
                </div>
              )}

              {installError && (
                <div className="install-notice warning" role="alert">
                  <strong>Install failed ({installError.code})</strong>
                  <p>{installErrorHint(installError.code, redact(installError.message))}</p>
                </div>
              )}

              {progress && !installedNow && (
                <div className="install-progress" role="status" aria-live="polite">
                  <div className="install-progress-top">
                    <strong>{PHASE_LABELS[progress.phase] ?? progress.phase}</strong>
                    {percent !== null && <span>{percent}%</span>}
                  </div>
                  <div className={"progress-track" + (percent === null ? " indeterminate" : "")}>
                    <div
                      className="progress-fill"
                      style={percent !== null ? { width: `${percent}%` } : undefined}
                    />
                  </div>
                  <p>{progress.message}</p>
                </div>
              )}

              {!progress && !installError && isPython && details && (
                <div className="install-info">
                  <div className="install-facts">
                    <span>
                      Version <strong>{details.version}</strong>
                    </span>
                    <span>
                      Download <strong>{details.download}</strong>
                    </span>
                    <span>
                      On disk <strong>{details.disk}</strong>
                    </span>
                  </div>
                  <p className="install-note">
                    Downloads from python.org and verifies SHA-256 before installing into app
                    storage. An interrupted download resumes. Pure-Python packages and Android
                    wheels work; manylinux/musllinux wheels do not.
                  </p>
                  {!bridge.installRuntime && (
                    <p className="install-note">
                      Installation requires the Android app. This browser preview cannot install
                      runtimes.
                    </p>
                  )}
                </div>
              )}

              {!progress && !installError && !isPython && (
                <div className="install-notice warning" role="alert">
                  <strong>Installation unavailable</strong>
                  <p>
                    {selectedRuntime.name} has no package or installer in this build. Nothing was
                    downloaded or changed on your device.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={closeModal} disabled={installing}>
                Close
              </button>
              {installing && progress && !installedNow && (
                <button className="btn ghost" onClick={cancelInstall}>
                  Cancel install
                </button>
              )}
              {installedNow && onOpenTerminal && (
                <button
                  className="btn ghost"
                  onClick={() => {
                    closeModal()
                    onOpenTerminal()
                  }}
                >
                  Open shell
                </button>
              )}
              {!installedNow && !progress && isPython && (
                <button
                  className="btn primary"
                  onClick={() => void startInstall()}
                  disabled={!bridge.installRuntime}
                >
                  {installError ? "Retry install" : `Install Python ${details?.version ?? "3"}`}
                </button>
              )}
              {!installedNow && !progress && !isPython && onOpenTerminal && (
                <button
                  className="btn primary"
                  onClick={() => {
                    closeModal()
                    onOpenTerminal()
                  }}
                >
                  Open system shell
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
