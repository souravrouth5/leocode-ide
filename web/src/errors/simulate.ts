import { AppError } from "../bridge/types"
import { isErrorCode } from "../bridge/types.gen"

/**
 * `?simulate=E_DISK_FULL` raises that error through the normal surfaces, so each
 * one can be demonstrated in mock mode without breaking anything.
 */
export function simulatedError(): AppError | null {
  if (typeof location === "undefined") return null
  const code = new URLSearchParams(location.search).get("simulate")
  if (!code || !isErrorCode(code)) return null
  return new AppError(code, `Simulated ${code} for the error-surface demo.`)
}
