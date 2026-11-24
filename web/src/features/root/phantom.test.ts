import { describe, it, expect, vi } from "vitest"
import {
  PHANTOM_COMMAND_ARGV,
  PHANTOM_TIMEOUT_MS,
  shouldShowPhantomOption,
  queryAndroidSdk,
  applyPhantomLimit
} from "./phantom"
import type { Bridge, ProcessEvent } from "../../bridge/types"

describe("phantom helper (R-09)", () => {
  describe("shouldShowPhantomOption", () => {
    it("returns true when SDK >= 31, root is enabled, and root is not lost", () => {
      expect(shouldShowPhantomOption({ sdk: 31, enabled: true, lost: false })).toBe(true)
      expect(shouldShowPhantomOption({ sdk: 34, enabled: true, lost: false })).toBe(true)
      expect(shouldShowPhantomOption({ sdk: 35, enabled: true, lost: false })).toBe(true)
    })

    it("returns false when SDK < 31", () => {
      expect(shouldShowPhantomOption({ sdk: 30, enabled: true, lost: false })).toBe(false)
      expect(shouldShowPhantomOption({ sdk: 28, enabled: true, lost: false })).toBe(false)
      expect(shouldShowPhantomOption({ sdk: 0, enabled: true, lost: false })).toBe(false)
    })

    it("returns false when SDK is unknown, null, or undefined", () => {
      expect(shouldShowPhantomOption({ sdk: null, enabled: true, lost: false })).toBe(false)
      expect(shouldShowPhantomOption({ sdk: undefined, enabled: true, lost: false })).toBe(false)
      expect(shouldShowPhantomOption({ sdk: Number.NaN, enabled: true, lost: false })).toBe(false)
    })

    it("returns false when root is disabled", () => {
      expect(shouldShowPhantomOption({ sdk: 34, enabled: false, lost: false })).toBe(false)
      expect(shouldShowPhantomOption({ sdk: 31, enabled: false, lost: false })).toBe(false)
    })

    it("returns false when root is in a lost state", () => {
      expect(shouldShowPhantomOption({ sdk: 34, enabled: true, lost: true })).toBe(false)
      expect(shouldShowPhantomOption({ sdk: 31, enabled: true, lost: true })).toBe(false)
    })

    it("returns false when disabled and lost", () => {
      expect(shouldShowPhantomOption({ sdk: 34, enabled: false, lost: true })).toBe(false)
    })
  })

  describe("argv and constants", () => {
    it("matches the exact command argv and timeout", () => {
      expect(PHANTOM_COMMAND_ARGV).toEqual([
        "/system/bin/sh",
        "-c",
        "device_config put activity_manager max_phantom_processes 2147483647 && device_config get activity_manager max_phantom_processes"
      ])
      expect(PHANTOM_TIMEOUT_MS).toBe(15000)
    })
  })

  describe("queryAndroidSdk", () => {
    it("returns androidSdk from bridge.info()", async () => {
      const mockBridge = {
        info: vi.fn().mockResolvedValue({
          app: "LeoCode",
          version: "0.1.0",
          mode: "android",
          androidSdk: 34,
          theme: { mode: "dark", effective: "dark" }
        }),
        diagnostics: vi.fn()
      } as unknown as Bridge

      const sdk = await queryAndroidSdk(mockBridge)
      expect(sdk).toBe(34)
      expect(mockBridge.diagnostics).not.toHaveBeenCalled()
    })

    it("falls back to diagnostics when bridge.info() has no androidSdk", async () => {
      const mockBridge = {
        info: vi.fn().mockResolvedValue({
          app: "LeoCode",
          version: "0.1.0",
          mode: "android",
          theme: { mode: "dark", effective: "dark" }
        }),
        diagnostics: vi.fn().mockResolvedValue("LeoCode diagnostics\nAndroid : 14 (SDK 34, patch 2024-01-01)")
      } as unknown as Bridge

      const sdk = await queryAndroidSdk(mockBridge)
      expect(sdk).toBe(34)
    })

    it("returns null if info fails and diagnostics does not contain SDK", async () => {
      const mockBridge = {
        info: vi.fn().mockRejectedValue(new Error("failed")),
        diagnostics: vi.fn().mockResolvedValue("No version details")
      } as unknown as Bridge

      const sdk = await queryAndroidSdk(mockBridge)
      expect(sdk).toBeNull()
    })
  })

  describe("applyPhantomLimit", () => {
    it("executes the command with root: true, timeoutMs: 15000 and returns stdout value", async () => {
      let capturedOnEvent: ((event: ProcessEvent) => void) | undefined
      const runMock = vi.fn().mockImplementation(
        (_argv: string[], _cwd: string, onEvent: (event: ProcessEvent) => void) => {
          capturedOnEvent = onEvent
          capturedOnEvent({ stream: "stdout", data: "2147483647\n" })
          return Promise.resolve(0)
        }
      )

      const mockBridge = { run: runMock } as unknown as Bridge

      const result = await applyPhantomLimit(mockBridge)
      expect(result).toBe("2147483647")
      expect(runMock).toHaveBeenCalledWith(
        [...PHANTOM_COMMAND_ARGV],
        ".",
        expect.any(Function),
        undefined,
        { root: true, timeoutMs: 15000 }
      )
    })

    it("throws an error when bridge.run returns non-zero exit code", async () => {
      const runMock = vi.fn().mockImplementation(
        (_argv: string[], _cwd: string, onEvent: (event: ProcessEvent) => void) => {
          onEvent({ stream: "stderr", data: "Permission denied\n" })
          return Promise.resolve(1)
        }
      )

      const mockBridge = { run: runMock } as unknown as Bridge

      await expect(applyPhantomLimit(mockBridge)).rejects.toThrow("Permission denied")
    })
  })
})
