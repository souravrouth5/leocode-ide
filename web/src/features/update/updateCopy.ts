import type { AppError, UpdateCheck } from "../../bridge"
import type { UpdateStatus } from "./updateStore"

/** User-facing copy for the Updates card, kept out of JSX so it is testable. */
export function describeUpdateStatus(
  status: UpdateStatus,
  check: UpdateCheck | null,
  error: AppError | null
): string {
  switch (status) {
    case "idle":
      return "Check for a signed LeoCode release. Updates install through Android's package installer."
    case "checking":
      return "Checking the signed release manifest…"
    case "current":
      return `LeoCode ${check?.currentVersion ?? ""} is up to date.`
    case "available":
      return `LeoCode ${check?.versionName ?? "update"} is available.`
    case "downloading":
      return "Downloading the update…"
    case "verifying":
      return "Checking the download's size, hash and signature…"
    case "installer":
      return "Android's installer is open. Confirm there to finish updating."
    case "error":
      return error?.message ?? "The update check failed."
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
