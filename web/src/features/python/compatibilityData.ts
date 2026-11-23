/**
 * Python Compatibility Matrix and Runtime Baseline Data (Task 33).
 *
 * Sourced from docs/compatibility.md, tracking proven packages on target test
 * devices (D1: Android 9, D2: Android 15), baseline runtime configuration,
 * and known mobile execution limitations.
 */

export type PackageType = "pure" | "native"

export type DeviceStatus = "PASS" | "FAIL" | "UNSUPPORTED" | "UNTESTED"

export interface CompatiblePackage {
  name: string
  type: PackageType
  d1Status: DeviceStatus
  d2Status: DeviceStatus
  overallStatus: "PASS" | "UNSUPPORTED" | "UNTESTED"
  version?: string
  notes: string
  wheelSource?: "PyPI" | "LeoCode wheel" | "PyPI Android wheel" | "None"
}

export interface CompatibilityBaselineItem {
  item: string
  value: string
  detail?: string
}

export interface CompatibilityMatrix {
  baseline: CompatibilityBaselineItem[]
  packages: CompatiblePackage[]
  limitations: string[]
}

export const PYTHON_COMPATIBILITY_DATA: CompatibilityMatrix = {
  baseline: [
    {
      item: "CPython version",
      value: "3.14.10",
      detail: "Official python.org aarch64-linux-android build"
    },
    {
      item: "Build",
      value: "Official build + LeoCode launcher (NDK 28.2.13676358)",
      detail: "16 KB aligned (80 ELFs verified in CI)"
    },
    {
      item: "Prefix",
      value: "<filesDir>/usr",
      detail: "Computed at runtime (e.g. /data/user/0/dev.leocode/files/usr)"
    },
    {
      item: "libc",
      value: "Bionic",
      detail: "Android system C library (incompatible with manylinux/glibc)"
    },
    {
      item: "pip",
      value: "ensurepip (26.2.2 observed on D1 and D2)",
      detail: "Bundled pip installer with TLS certifi bundle"
    },
    {
      item: "CA bundle",
      value: "certifi",
      detail: "Configured via SSL_CERT_FILE"
    },
    {
      item: "venv",
      value: "python -m venv",
      detail: "Internal storage only (app-private directory)"
    },
    {
      item: "Compiler on device",
      value: "none (MVP)",
      detail: "No gcc or clang toolchain on unrooted Android"
    },
    {
      item: "Native packages",
      value: "LeoCode Android wheels (cp314-cp314-android_24_arm64_v8a)",
      detail: "Built with build_android_wheel.py; PyPI Android wheels accepted on matching tags"
    }
  ],
  packages: [
    {
      name: "requests",
      type: "pure",
      d1Status: "PASS",
      d2Status: "PASS",
      overallStatus: "PASS",
      version: "2.34.2",
      notes: "2.34.2 from PyPI; https://example.com returned 200",
      wheelSource: "PyPI"
    },
    {
      name: "flask",
      type: "pure",
      d1Status: "UNTESTED",
      d2Status: "UNTESTED",
      overallStatus: "UNTESTED",
      notes: "Pure-Python WSGI web application framework",
      wheelSource: "PyPI"
    },
    {
      name: "rich",
      type: "pure",
      d1Status: "UNTESTED",
      d2Status: "UNTESTED",
      overallStatus: "UNTESTED",
      notes: "Pure-Python terminal formatting and rich text library",
      wheelSource: "PyPI"
    },
    {
      name: "pygments",
      type: "pure",
      d1Status: "PASS",
      d2Status: "PASS",
      overallStatus: "PASS",
      version: "2.21.0",
      notes: "2.21.0; bin/pygmentize shebang points at the venv python",
      wheelSource: "PyPI"
    },
    {
      name: "markupsafe",
      type: "native",
      d1Status: "PASS",
      d2Status: "PASS",
      overallStatus: "PASS",
      version: "3.0.2",
      notes: "3.0.2 from the LeoCode wheel; _speedups imports; PyPI has no Android wheel",
      wheelSource: "LeoCode wheel"
    },
    {
      name: "charset-normalizer",
      type: "native",
      d1Status: "PASS",
      d2Status: "PASS",
      overallStatus: "PASS",
      version: "3.5.2",
      notes: "3.5.2 from PyPI; pip selected cp314-cp314-android_24_arm64_v8a and md...so imports",
      wheelSource: "PyPI Android wheel"
    },
    {
      name: "ujson",
      type: "native",
      d1Status: "UNTESTED",
      d2Status: "UNTESTED",
      overallStatus: "UNTESTED",
      notes: "Recipe to add with build_android_wheel.py",
      wheelSource: "None"
    },
    {
      name: "numpy",
      type: "native",
      d1Status: "UNSUPPORTED",
      d2Status: "UNSUPPORTED",
      overallStatus: "UNSUPPORTED",
      notes: "Check for a PyPI Android wheel; else unsupported / no Android wheel",
      wheelSource: "None"
    },
    {
      name: "cryptography",
      type: "native",
      d1Status: "UNTESTED",
      d2Status: "UNTESTED",
      overallStatus: "UNTESTED",
      notes: "Needs OpenSSL linkage and Rust compiler; consider pure-Python alternatives",
      wheelSource: "None"
    }
  ],
  limitations: [
    "No gcc/clang on device: sdists with C code cannot build. pip install succeeds only for pure-Python packages and Android wheels.",
    "manylinux / musllinux wheels never install (wrong libc: Android uses Bionic libc).",
    "Console scripts rely on #! lines limited to ~127 bytes; prefer python -m pkg.",
    "pip may need --no-cache-dir on low-storage devices.",
    "Android kills long pip runs under memory pressure or when backgrounded (phantom-process killer on Android 12+); the session service reduces this."
  ]
}
