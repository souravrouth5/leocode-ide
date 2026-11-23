import { describe, expect, it } from "vitest"
import {
  classifyPipError,
  extractPackageName,
  isPipFailure,
  PIP_ERROR_EXPLANATIONS
} from "./pipClassifier"

describe("pip failure classifier (Task 32)", () => {
  describe("NO_MATCHING_WHEEL", () => {
    const numpyFixture = `
Looking in indexes: https://pypi.org/simple/
Collecting numpy
  ERROR: Could not find a version that satisfies the requirement numpy (from versions: none)
ERROR: No matching distribution found for numpy
`
    it("classifies missing wheel on Android arm64", () => {
      const result = classifyPipError(numpyFixture)
      expect(result.kind).toBe("NO_MATCHING_WHEEL")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.NO_MATCHING_WHEEL)
      expect(result.package).toBe("numpy")
      expect(result.suggestedAction).toContain("pure-Python")
    })

    const platformMismatchFixture = `
Processing ./some_pkg-1.0-cp310-cp310-win_amd64.whl
ERROR: some_pkg-1.0-cp310-cp310-win_amd64.whl is not a supported wheel on this platform.
`
    it("classifies unsupported wheel platform", () => {
      const result = classifyPipError(platformMismatchFixture)
      expect(result.kind).toBe("NO_MATCHING_WHEEL")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.NO_MATCHING_WHEEL)
    })
  })

  describe("NEEDS_COMPILER", () => {
    const gccFixture = `
Collecting cffi
  Using cached cffi-1.16.0.tar.gz (512 kB)
  Installing build dependencies ... done
  Getting requirements to build wheel ... done
  Preparing metadata (pyproject.toml) ... done
Building wheels for collected packages: cffi
  Building wheel for cffi (pyproject.toml) ... error
  error: subprocess-exited-with-error
  running build_ext
  building '_cffi_backend' extension
  error: command 'gcc' failed: No such file or directory
  [end of output]
  ERROR: Failed building wheel for cffi
ERROR: Failed to build installable wheels for one or more PEP 517 projects
`
    it("classifies missing gcc compiler", () => {
      const result = classifyPipError(gccFixture)
      expect(result.kind).toBe("NEEDS_COMPILER")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.NEEDS_COMPILER)
      expect(result.package).toBe("cffi")
      expect(result.suggestedAction).toBeDefined()
    })

    const clangFixture = `
Collecting ujson
  Using cached ujson-5.9.0.tar.gz
Building wheels for collected packages: ujson
  Building wheel for ujson (setup.py) ... error
  error: command 'clang' failed: No such file or directory: 'clang'
  ERROR: Failed building wheel for ujson
`
    it("classifies missing clang compiler", () => {
      const result = classifyPipError(clangFixture)
      expect(result.kind).toBe("NEEDS_COMPILER")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.NEEDS_COMPILER)
      expect(result.package).toBe("ujson")
    })

    const rustFixture = `
Collecting cryptography
  Using cached cryptography-42.0.5.tar.gz
  Installing build dependencies ... done
  Running setup.py bdist_wheel for cryptography ... error
  error: can't find Rust compiler
  Cargo, the Rust package manager, is not installed or not in PATH.
  ERROR: Failed building wheel for cryptography
`
    it("classifies missing rust/cargo compiler for cryptography", () => {
      const result = classifyPipError(rustFixture)
      expect(result.kind).toBe("NEEDS_COMPILER")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.NEEDS_COMPILER)
      expect(result.package).toBe("cryptography")
      expect(result.suggestedAction).toContain("pycryptodome")
    })

    const missingHeaderFixture = `
Collecting pyyaml
  Building wheel for pyyaml (setup.py) ... error
  yaml.h: No such file or directory
  fatal error: yaml.h: No such file or directory
  compilation terminated.
  ERROR: Failed building wheel for pyyaml
`
    it("classifies missing C headers compilation failure", () => {
      const result = classifyPipError(missingHeaderFixture)
      expect(result.kind).toBe("NEEDS_COMPILER")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.NEEDS_COMPILER)
    })
  })

  describe("OFFLINE", () => {
    const dnsFailureFixture = `
WARNING: Retrying (Retry(total=4, connect=None, read=None, redirect=None, status=None)) after connection broken by 'NewConnectionError('<pip._vendor.urllib3.connection.HTTPSConnection object>: Failed to establish a new connection: [Errno -3] Temporary failure in name resolution')': /simple/requests/
ERROR: Could not fetch URL https://pypi.org/simple/requests/: connection error: [Errno -3] Temporary failure in name resolution - skipping
ERROR: Could not find a version that satisfies the requirement requests (from versions: none)
`
    it("classifies DNS name resolution failure", () => {
      const result = classifyPipError(dnsFailureFixture)
      expect(result.kind).toBe("OFFLINE")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.OFFLINE)
      expect(result.package).toBe("requests")
      expect(result.suggestedAction).toContain("internet connection")
    })

    const timeoutFixture = `
Collecting rich
  WARNING: Retrying (Retry(total=2, connect=None, read=None, redirect=None, status=None)) after connection broken by 'ConnectTimeoutError': /simple/rich/
ERROR: Network is unreachable
`
    it("classifies network unreachable / timeout failure", () => {
      const result = classifyPipError(timeoutFixture)
      expect(result.kind).toBe("OFFLINE")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.OFFLINE)
    })
  })

  describe("DISK_FULL", () => {
    const diskFullFixture = `
Collecting bigpackage
  Downloading bigpackage-2.0.0.tar.gz (150 MB)
ERROR: Could not install packages due to an OSError: [Errno 28] No space left on device
`
    it("classifies Errno 28 No space left on device", () => {
      const result = classifyPipError(diskFullFixture)
      expect(result.kind).toBe("DISK_FULL")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.DISK_FULL)
      expect(result.suggestedAction).toContain("storage space")
    })
  })

  describe("UNKNOWN", () => {
    const unknownFixture = `
Collecting something
  Running setup.py install for something
  Traceback (most recent call last):
    File "setup.py", line 12, in <module>
      raise RuntimeError("Unexpected internal error")
  RuntimeError: Unexpected internal error
`
    it("falls back to UNKNOWN with explanation to inspect log", () => {
      const result = classifyPipError(unknownFixture)
      expect(result.kind).toBe("UNKNOWN")
      expect(result.explanation).toBe(PIP_ERROR_EXPLANATIONS.UNKNOWN)
      expect(result.package).toBe("something")
      expect(result.suggestedAction).toBeDefined()
    })
  })

  describe("helpers", () => {
    it("extracts package name across various log patterns", () => {
      expect(
        extractPackageName("ERROR: No matching distribution found for flask")
      ).toBe("flask")
      expect(
        extractPackageName(
          "Could not find a version that satisfies the requirement scipy>=1.7.0"
        )
      ).toBe("scipy")
      expect(
        extractPackageName("ERROR: Failed building wheel for pandas")
      ).toBe("pandas")
    })

    it("checks isPipFailure correctly", () => {
      expect(isPipFailure("Successfully installed requests-2.31.0")).toBe(false)
      expect(isPipFailure("ERROR: No matching distribution found")).toBe(true)
      expect(isPipFailure(["line 1", "error: command 'gcc' failed"])).toBe(true)
      expect(isPipFailure("")).toBe(false)
    })

    it("handles string array log input as well as single string", () => {
      const lines = [
        "Collecting numpy",
        "ERROR: No matching distribution found for numpy"
      ]
      const result = classifyPipError(lines)
      expect(result.kind).toBe("NO_MATCHING_WHEEL")
      expect(result.package).toBe("numpy")
    })
  })
})
