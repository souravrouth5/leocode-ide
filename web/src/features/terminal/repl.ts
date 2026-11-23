import type { Bridge, PythonStatus } from "../../bridge"
import { venvEnv } from "../python/pythonStore"

export interface PythonReplSpec {
  executable: string
  args: string[]
  /** Command line string formatted for interactive shell execution */
  commandString: string
  /** Environment variables, including VIRTUAL_ENV and PATH when venv exists */
  env: Record<string, string>
  /** Human-readable title */
  title: string
  /** Mode: using project venv, runtime python, or system fallback */
  mode: "venv" | "runtime" | "system"
}

export interface ReplOptions {
  status?: PythonStatus | null
  interactiveArgs?: string[]
}

/**
 * Resolves the Python REPL launch specification based on project PythonStatus.
 *
 * Ensures the interactive session runs `python3 -i` with the active project's
 * `.venv` (and VIRTUAL_ENV/PATH) if present, or with the bundled runtime Python.
 */
export function getPythonReplSpec(
  status?: PythonStatus | null,
  options?: { interactiveArgs?: string[] }
): PythonReplSpec {
  const args = options?.interactiveArgs ?? ["-i"]
  const argStr = args.join(" ")

  if (status?.venvExists && status.venvPython && status.venvPath) {
    const env = venvEnv(status)
    const pythonPath = status.venvPython
    const commandString = `export VIRTUAL_ENV="${status.venvPath}" PATH="${env.PATH}" && "${pythonPath}" ${argStr}\n`

    return {
      executable: pythonPath,
      args,
      commandString,
      env,
      title: "Python REPL (.venv)",
      mode: "venv"
    }
  }

  if (status?.runtimeInstalled && status.runtimePython) {
    const pythonPath = status.runtimePython
    const commandString = `"${pythonPath}" ${argStr}\n`

    return {
      executable: pythonPath,
      args,
      commandString,
      env: {},
      title: "Python REPL (runtime)",
      mode: "runtime"
    }
  }

  return {
    executable: "python3",
    args,
    commandString: `python3 ${argStr}\n`,
    env: {},
    title: "Python REPL",
    mode: "system"
  }
}

/**
 * Resolves the REPL specification, querying bridge.pythonStatus if not already provided.
 */
export async function resolveReplSpec(
  bridge?: Pick<Bridge, "pythonStatus"> | null,
  cachedStatus?: PythonStatus | null
): Promise<PythonReplSpec> {
  if (cachedStatus) {
    return getPythonReplSpec(cachedStatus)
  }
  if (bridge?.pythonStatus) {
    try {
      const status = await bridge.pythonStatus({})
      return getPythonReplSpec(status)
    } catch {
      // Fallback to default
    }
  }
  return getPythonReplSpec(null)
}

/**
 * Sends the REPL launch command into an active terminal handle.
 */
export function launchReplSession(
  handle: { write: (data: Uint8Array) => void } | null,
  spec: PythonReplSpec
): boolean {
  if (!handle) return false
  const encoder = new TextEncoder()
  handle.write(encoder.encode(spec.commandString))
  return true
}
