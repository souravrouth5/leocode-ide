import { describe, expect, it } from "vitest"
import {
  REDACTED,
  REDACTED_PATH,
  REDACTED_PRIVATE_KEY,
  errorMessage,
  redact
} from "./redact"

describe("redact (W-09)", () => {
  it("masks prefixed assignment secrets", () => {
    expect(redact("GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345")).toBe(
      `GITHUB_TOKEN=${REDACTED}`
    )
    expect(redact("DB_PASSWORD=hunter2")).toBe(`DB_PASSWORD=${REDACTED}`)
    expect(redact("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI")).toBe(
      `AWS_SECRET_ACCESS_KEY=${REDACTED}`
    )
    expect(redact("api_key: 12345")).toBe(`api_key: ${REDACTED}`)
    expect(redact("MY_API_KEY = s3cret")).toBe(`MY_API_KEY = ${REDACTED}`)
    expect(redact("client_secret='two words'")).toBe(`client_secret='${REDACTED}'`)
  })

  it("masks JSON and quoted keys", () => {
    expect(redact('{"token": "abc123"}')).toBe(`{"token": "${REDACTED}"}`)
    expect(redact("config: {'password': 'hunter2', mode: 'dev'}")).toBe(
      `config: {'password': '${REDACTED}', mode: 'dev'}`
    )
    expect(redact('"refresh_token": "r3fr3sh"')).toBe(`"refresh_token": "${REDACTED}"`)
  })

  it("masks Authorization schemes", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe(
      `Authorization: Bearer ${REDACTED}`
    )
    expect(redact("header Basic dXNlcjpwYXNz")).toBe(`header Basic ${REDACTED}`)
    // A short word is not a credential and stays readable.
    expect(redact("Bearer token")).toBe("Bearer token")
  })

  it("masks URL user-info but keeps the host", () => {
    expect(redact("fetch https://user:password@example.com/repo.git failed")).toBe(
      `fetch https://${REDACTED}@example.com/repo.git failed`
    )
    expect(redact("ssh://git@github.com/org/repo")).toBe(
      `ssh://${REDACTED}@github.com/org/repo`
    )
  })

  it("masks known token prefixes without a name in front", () => {
    expect(redact("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(REDACTED)
    expect(redact("github_pat_11ABCDEFG0123456789_abcdefghij")).toBe(REDACTED)
    expect(redact("sk-proj-abcdefghijklmnop1234")).toBe(REDACTED)
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTED)
    expect(redact("xoxb-123456789012-abcdefghij")).toBe(REDACTED)
  })

  it("masks PEM private-key blocks whole", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890",
      "-----END RSA PRIVATE KEY-----"
    ].join("\n")
    expect(redact(`before\n${pem}\nafter`)).toBe(`before\n${REDACTED_PRIVATE_KEY}\nafter`)

    const unterminated = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk"
    expect(redact(unterminated)).toBe(REDACTED_PRIVATE_KEY)

    const pgp = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc\n-----END PGP PRIVATE KEY BLOCK-----"
    expect(redact(pgp)).toBe(REDACTED_PRIVATE_KEY)
  })

  it("masks absolute paths under well-known roots", () => {
    expect(redact("cannot write /storage/emulated/0/Download/a.txt")).toBe(
      `cannot write ${REDACTED_PATH}`
    )
    expect(redact("/data/user/0/dev.leocode/files/home: denied")).toBe(
      `${REDACTED_PATH}: denied`
    )
    for (const root of [
      "/sdcard",
      "/system",
      "/mnt",
      "/home",
      "/tmp",
      "/proc",
      "/vendor",
      "/odm",
      "/product",
      "/apex",
      "/root"
    ]) {
      expect(redact(`open ${root}/nested/file`), root).toBe(`open ${REDACTED_PATH}`)
    }
  })

  it("leaves ordinary code and output alone", () => {
    const text = [
      "Saved main.py in src/ (42 tokens, 3 secrets? no)",
      "Traceback (most recent call last):",
      '  File "main.py", line 3',
      "KeyError: 'PATH'"
    ].join("\n")
    expect(redact(text)).toBe(text)
    expect(redact("https://example.com/data/report")).toBe(
      "https://example.com/data/report"
    )
  })

  it("survives empty and non-string input through errorMessage", () => {
    expect(redact("")).toBe("")
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage("plain")).toBe("plain")
    expect(errorMessage(null)).toBe("")
    expect(
      errorMessage({
        toString() {
          throw new Error("hostile")
        }
      })
    ).toBe("")
  })
})
