/**
 * Pip failure log classification (Task 32).
 *
 * Classifies pip failure logs into root causes suitable for mobile/unrooted Android
 * environments where compilers and certain wheels are not available.
 */

export type PipFailureKind =
  | "NO_MATCHING_WHEEL"
  | "NEEDS_COMPILER"
  | "OFFLINE"
  | "DISK_FULL"
  | "UNKNOWN"

export interface PipClassification {
  kind: PipFailureKind
  explanation: string
  package?: string
  suggestedAction?: string
}

export const PIP_ERROR_EXPLANATIONS: Record<PipFailureKind, string> = {
  NO_MATCHING_WHEEL:
    "No matching wheel found for Android arm64. PyPI may not have pre-built Android wheels for this package.",
  NEEDS_COMPILER:
    "Building this package requires a C/C++ compiler which is not available on this unrooted Android environment.",
  OFFLINE:
    "Network connection failed. Verify internet connectivity or proxy settings.",
  DISK_FULL:
    "Device storage is full. Free up disk space and try again.",
  UNKNOWN:
    "Installation failed for an unknown reason. Inspect the installation log for details."
}

export const KNOWN_PACKAGE_ALTERNATIVES: Record<string, string> = {
  numpy:
    "NumPy requires native C/Fortran compilation. Pre-built wheels for Android arm64 are not available on standard PyPI. Look for pure-Python math/numeric libraries.",
  scipy:
    "SciPy requires C/C++/Fortran compilers and BLAS/LAPACK libraries. Consider pure-Python alternatives.",
  pandas:
    "Pandas relies on compiled C extensions. Consider using standard library modules like 'csv' or 'sqlite3' for data manipulation.",
  cryptography:
    "Cryptography requires Rust and OpenSSL C headers. Consider 'pycryptodome' or pure-Python cryptographic libraries.",
  pillow:
    "Pillow requires native C imaging libraries. Consider pure-Python image parsers.",
  lxml:
    "lxml requires native libxml2/libxslt C libraries. Consider 'beautifulsoup4' with the built-in 'html.parser' or 'defusedxml'.",
  psycopg2:
    "psycopg2 requires native PostgreSQL libpq headers. Consider pure-Python alternatives like 'pg8000' or 'psycopg' v3.",
  cffi:
    "cffi requires a C compiler for building native bindings.",
  uvloop:
    "uvloop requires native C libuv. Use Python's built-in 'asyncio' event loop instead."
}

const DEFAULT_SUGGESTIONS: Record<PipFailureKind, string> = {
  NO_MATCHING_WHEEL:
    "PyPI may not have pre-built Android wheels for this package. Check if a pure-Python alternative exists or verify the package name in requirements.txt.",
  NEEDS_COMPILER:
    "Look for pure-Python alternatives or packages with pre-built wheels that do not require a native C/C++ compiler.",
  OFFLINE:
    "Verify your internet connection or proxy settings, and retry.",
  DISK_FULL:
    "Free up storage space on your device and try again.",
  UNKNOWN:
    "Inspect the installation log for details."
}

/**
 * Extracts candidate package name from pip log output.
 */
export function extractPackageName(rawLog: string): string | undefined {
  // Try requirement specifier error: "Could not find a version that satisfies the requirement foo"
  const reqMatch = rawLog.match(
    /Could not find a version that satisfies the requirement\s+([A-Za-z0-9_.-]+)/i
  )
  if (reqMatch?.[1]) {
    return cleanPackageName(reqMatch[1])
  }

  // Try distribution error: "No matching distribution found for foo"
  const distMatch = rawLog.match(
    /No matching distribution found for\s+([A-Za-z0-9_.-]+)/i
  )
  if (distMatch?.[1]) {
    return cleanPackageName(distMatch[1])
  }

  // Try failed building wheel error: "Failed building wheel for foo"
  const wheelMatch = rawLog.match(
    /Failed building wheel for\s+([A-Za-z0-9_.-]+)/i
  )
  if (wheelMatch?.[1]) {
    return cleanPackageName(wheelMatch[1])
  }

  // Try "Building wheel for foo"
  const buildingMatch = rawLog.match(
    /Building wheel for\s+([A-Za-z0-9_.-]+)/i
  )
  if (buildingMatch?.[1]) {
    return cleanPackageName(buildingMatch[1])
  }

  // Try setup.py error: "Running setup.py ... for foo"
  const setupMatch = rawLog.match(
    /Running setup\.py\s+[^\n]*\s+for\s+([A-Za-z0-9_.-]+)/i
  )
  if (setupMatch?.[1]) {
    return cleanPackageName(setupMatch[1])
  }

  // Try collecting line: "Collecting foo"
  const collectMatch = rawLog.match(
    /Collecting\s+([A-Za-z0-9_.-]+)/i
  )
  if (collectMatch?.[1]) {
    return cleanPackageName(collectMatch[1])
  }

  return undefined
}

function cleanPackageName(name: string): string {
  // Strip comparison operators and versions if present, e.g. "foo>=1.0" or "foo==2.1"
  const cleaned = name.split(/[<>=!~;]/)[0]?.trim().toLowerCase()
  return cleaned || name.trim().toLowerCase()
}

/**
 * Checks if the log contains indications of a pip failure.
 */
export function isPipFailure(log: string | string[]): boolean {
  const text = Array.isArray(log) ? log.join("\n") : log
  if (!text || text.trim().length === 0) return false

  return (
    text.includes("ERROR:") ||
    text.includes("error:") ||
    text.includes("Traceback (most recent call last):") ||
    text.includes("Failed building wheel") ||
    text.includes("No matching distribution found") ||
    text.includes("Could not find a version that satisfies") ||
    text.includes("No space left on device") ||
    text.includes("Failed to establish a new connection") ||
    text.includes("Temporary failure in name resolution") ||
    text.includes("subprocess-exited-with-error") ||
    text.includes("Exception:")
  )
}

/**
 * Classifies pip failure logs into known root causes with explanations and suggested actions.
 */
export function classifyPipError(log: string | string[]): PipClassification {
  const text = Array.isArray(log) ? log.join("\n") : log
  const pkg = extractPackageName(text)

  // 1. DISK_FULL
  if (
    text.includes("No space left on device") ||
    text.includes("[Errno 28]") ||
    /disk.*full/i.test(text)
  ) {
    return {
      kind: "DISK_FULL",
      explanation: PIP_ERROR_EXPLANATIONS.DISK_FULL,
      package: pkg,
      suggestedAction: DEFAULT_SUGGESTIONS.DISK_FULL
    }
  }

  // 2. OFFLINE / Network errors
  if (
    text.includes("Failed to establish a new connection") ||
    text.includes("Temporary failure in name resolution") ||
    text.includes("NameResolutionError") ||
    text.includes("[Errno -3]") ||
    text.includes("[Errno 110]") ||
    text.includes("[Errno 111]") ||
    text.includes("Network is unreachable") ||
    text.includes("ConnectTimeoutError") ||
    text.includes("ReadTimeoutError") ||
    text.includes("ProxyError") ||
    text.includes("CERTIFICATE_VERIFY_FAILED") ||
    text.includes("connection error") ||
    (text.includes("WARNING: Retrying (Retry(") && text.includes("Could not fetch URL"))
  ) {
    return {
      kind: "OFFLINE",
      explanation: PIP_ERROR_EXPLANATIONS.OFFLINE,
      package: pkg,
      suggestedAction: DEFAULT_SUGGESTIONS.OFFLINE
    }
  }

  // 3. NEEDS_COMPILER (C/C++/Rust build failures)
  if (
    text.includes("error: command 'gcc' failed") ||
    text.includes("error: command 'clang' failed") ||
    text.includes("error: command 'cc' failed") ||
    text.includes("No such file or directory: 'gcc'") ||
    text.includes("No such file or directory: 'clang'") ||
    text.includes("No such file or directory: 'cc'") ||
    text.includes("Unable to find a working compiler") ||
    text.includes("Cargo, the Rust package manager, is not installed") ||
    text.includes("can't find Rust compiler") ||
    text.includes("Failed building wheel for") ||
    text.includes("Failed to build installable wheels for one or more PEP 517 projects") ||
    /fatal error:\s+.*\.h:\s+No such file or directory/i.test(text)
  ) {
    const alternative = pkg ? KNOWN_PACKAGE_ALTERNATIVES[pkg] : undefined
    return {
      kind: "NEEDS_COMPILER",
      explanation: PIP_ERROR_EXPLANATIONS.NEEDS_COMPILER,
      package: pkg,
      suggestedAction: alternative ?? DEFAULT_SUGGESTIONS.NEEDS_COMPILER
    }
  }

  // 4. NO_MATCHING_WHEEL
  if (
    text.includes("Could not find a version that satisfies the requirement") ||
    text.includes("No matching distribution found") ||
    text.includes("none of the wheel platforms match the current platform") ||
    text.includes("is not a supported wheel on this platform")
  ) {
    const alternative = pkg ? KNOWN_PACKAGE_ALTERNATIVES[pkg] : undefined
    return {
      kind: "NO_MATCHING_WHEEL",
      explanation: PIP_ERROR_EXPLANATIONS.NO_MATCHING_WHEEL,
      package: pkg,
      suggestedAction: alternative ?? DEFAULT_SUGGESTIONS.NO_MATCHING_WHEEL
    }
  }

  // 5. UNKNOWN
  return {
    kind: "UNKNOWN",
    explanation: PIP_ERROR_EXPLANATIONS.UNKNOWN,
    package: pkg,
    suggestedAction: DEFAULT_SUGGESTIONS.UNKNOWN
  }
}
