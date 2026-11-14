import { describe, expect, it } from "vitest"
import {
  FAST_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  defaultTimeoutMs,
  isIdempotentRead,
  timeoutMsFor
} from "./timeouts"

describe("bridge timeout policy (Task 11)", () => {
  it("uses the fast default for app and read methods", () => {
    for (const method of ["app.info", "fs.list", "fs.read", "term.write", "root.status"]) {
      expect(defaultTimeoutMs(method)).toBe(FAST_TIMEOUT_MS)
    }
  })

  it("uses the write default for writes and workspace mutations", () => {
    expect(defaultTimeoutMs("fs.write")).toBe(WRITE_TIMEOUT_MS)
    expect(defaultTimeoutMs("workspace.create")).toBe(WRITE_TIMEOUT_MS)
  })

  it("never times out a user-driven picker", () => {
    for (const method of [
      "saf.open",
      "saf.save",
      "storage.requestPermission",
      "root.request",
      "ssh.hostkey.answer"
    ]) {
      expect(defaultTimeoutMs(method)).toBeNull()
    }
  })

  it("limits streamed methods to their reply-on-start", () => {
    expect(defaultTimeoutMs("proc.run")).toBe(FAST_TIMEOUT_MS)
    expect(defaultTimeoutMs("runtime.install")).toBe(FAST_TIMEOUT_MS)
  })

  it("lets a call override or disable its timeout", () => {
    expect(timeoutMsFor("fs.read", { timeoutMs: 1234 })).toBe(1234)
    expect(timeoutMsFor("fs.read", { timeoutMs: null })).toBeNull()
    expect(timeoutMsFor("fs.read")).toBe(FAST_TIMEOUT_MS)
  })

  it("only retries reads", () => {
    expect(isIdempotentRead("fs.read")).toBe(true)
    expect(isIdempotentRead("fs.list")).toBe(true)
    expect(isIdempotentRead("app.info")).toBe(true)
    expect(isIdempotentRead("fs.write")).toBe(false)
    expect(isIdempotentRead("proc.run")).toBe(false)
  })
})
