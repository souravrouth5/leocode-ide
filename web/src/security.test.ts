import { describe, expect, it } from "vitest"
import { CSP_PLACEHOLDER, DEV_CSP, PROD_CSP } from "./csp"
import html from "../index.html?raw"

describe("asset-origin security (Task 8)", () => {

  it("keeps the CSP placeholder that Vite replaces", () => {
    expect(html).toContain(`content="${CSP_PLACEHOLDER}"`)
  })

  it("ships a strict production policy", () => {
    expect(PROD_CSP).toContain("default-src 'self'")
    expect(PROD_CSP).toContain("script-src 'self'")
    expect(PROD_CSP).toContain("font-src 'self'")
    expect(PROD_CSP).not.toContain("unsafe-eval")
    expect(PROD_CSP).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  it("only relaxes script-src and connect-src in development", () => {
    expect(DEV_CSP).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
    expect(DEV_CSP).toContain("connect-src 'self' ws://localhost:5173")
    expect(DEV_CSP).toContain("default-src 'self'")
  })

  it("has no remote origins in index.html", () => {
    const remote = html.match(/https?:\/\/[^"'\s>]+/g) ?? []
    expect(remote).toEqual([])
  })

  it("has no remote stylesheet or font preconnect", () => {
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    expect(html).not.toMatch(/<link[^>]+href="https?:/)
  })

  it("has no inline scripts that the production policy would block", () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) expect(tag).toMatch(/\bsrc=/)
  })
})
