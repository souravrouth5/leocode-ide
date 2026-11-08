import { useCallback, useEffect, useState } from "react"
import type { AppInfo, Bridge } from "../bridge"
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
    description: "CPython 3.11 runtime bundled for Android Bionic arm64-v8a.",
    guidance:
      "Self-contained userspace runtime bundled in usr/bin. Includes standard library, pip, and SQLite3. Tested with W^X execution on Android 9/11.",
    envVars: {
      PYTHONHOME: "/data/data/dev.leocode/files/usr",
      PYTHONPATH: "/data/data/dev.leocode/files/usr/lib/python3.11",
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
  const [installMsg, setInstallMsg] = useState<string | null>(null)

  const probeAll = useCallback(async () => {
    setProbing(true)
    const updated = [...DEFAULT_RUNTIMES]

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
      } catch {
        item.status = "missing"
      }
      updated[i] = item
    }

    setRuntimes(updated)
    setLastProbed(new Date())
    setProbing(false)
  }, [bridge])

  useEffect(() => {
    void probeAll()
  }, [probeAll])

  const triggerInstall = (rt: RuntimeCardData) => {
    setSelectedRuntime(rt)
    if (rt.id === "python") {
      setInstallMsg(
        "CPython 3.11 bundle manifest loaded. Run 'scripts/build-python.sh' or use terminal to install into usr/."
      )
    } else {
      setInstallMsg(
        `${rt.name} packaging is planned for ${rt.category}. Use Terminal for current system tools.`
      )
    }
  }

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
                    (isReady ? "ready" : rt.status === "probing" ? "probing" : "missing")
                  }
                >
                  {isReady ? (
                    <>
                      <CheckIcon size={13} />
                      {rt.status === "ready" ? "Ready" : "Installed"}
                    </>
                  ) : rt.status === "probing" ? (
                    "Checking…"
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
                    className="btn primary small"
                    onClick={() => triggerInstall(rt)}
                  >
                    <span>Install / Setup</span>
                  </button>
                )}
                <button
                  className="btn ghost small"
                  onClick={() => setSelectedRuntime(rt)}
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
        <div className="modal-backdrop" onClick={() => setSelectedRuntime(null)}>
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
                onClick={() => setSelectedRuntime(null)}
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-field">
                <span className="field-label">Status</span>
                <span className={"status-badge " + (selectedRuntime.status === "ready" || selectedRuntime.status === "installed" ? "ready" : "missing")}>
                  {selectedRuntime.status.toUpperCase()}
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

              {installMsg && (
                <div className="install-notice">
                  {installMsg}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  setSelectedRuntime(null)
                  setInstallMsg(null)
                }}
              >
                Close
              </button>
              {onOpenTerminal && (
                <button
                  className="btn primary"
                  onClick={() => {
                    setSelectedRuntime(null)
                    onOpenTerminal()
                  }}
                >
                  Open Terminal
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
