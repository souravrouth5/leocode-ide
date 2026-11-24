import type { Bridge } from "../../bridge/types"

/**
 * Android 12+ (API 31+) phantom-process killer command (R-09 / Task 10).
 *
 * Command sets activity_manager max_phantom_processes to 2147483647 and
 * reads back the updated value to verify application.
 */
export const PHANTOM_COMMAND_ARGV = [
  "/system/bin/sh",
  "-c",
  "device_config put activity_manager max_phantom_processes 2147483647 && device_config get activity_manager max_phantom_processes"
] as const

export const PHANTOM_TIMEOUT_MS = 15000

export interface ShouldShowPhantomOptionParams {
  sdk?: number | null
  enabled: boolean
  lost: boolean
}

/**
 * Pure predicate controlling phantom limit UI visibility.
 *
 * Rules:
 * - SDK >= 31 (Android 12+)
 * - Root mode enabled
 * - Store not in lost state
 * - If SDK is unknown/null/undefined, hide the option
 */
export function shouldShowPhantomOption({
  sdk,
  enabled,
  lost
}: ShouldShowPhantomOptionParams): boolean {
  if (typeof sdk !== "number" || Number.isNaN(sdk) || sdk < 31) {
    return false
  }
  if (!enabled || lost) {
    return false
  }
  return true
}

/**
 * Query Android SDK version from app.info or diagnostics fallback.
 */
export async function queryAndroidSdk(bridge: Bridge): Promise<number | null> {
  try {
    const info = await bridge.info()
    if (typeof info.androidSdk === "number") {
      return info.androidSdk
    }
  } catch {
    // Fall through to diagnostics
  }

  try {
    const diag = await bridge.diagnostics()
    const match = /SDK\s+(\d+)/i.exec(diag)
    if (match) {
      return parseInt(match[1], 10)
    }
  } catch {
    // Both failed or unavailable
  }

  return null
}

/**
 * Apply the phantom-process limit as root through proc.run via bridge.run.
 *
 * Returns the read-back value from device_config get activity_manager max_phantom_processes.
 */
export async function applyPhantomLimit(bridge: Bridge): Promise<string> {
  let stdout = ""
  let stderr = ""

  const exitCode = await bridge.run(
    [...PHANTOM_COMMAND_ARGV],
    ".",
    (event) => {
      if (event.stream === "stdout") stdout += event.data
      if (event.stream === "stderr") stderr += event.data
    },
    undefined,
    { root: true, timeoutMs: PHANTOM_TIMEOUT_MS }
  )

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `device_config failed with exit code ${exitCode}`)
  }

  return stdout.trim()
}
