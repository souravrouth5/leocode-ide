import { beforeEach, describe, expect, it } from "vitest"
import { MockBridge } from "./mock"
import type { GitProgress, SshHostPrompt } from "./types"

beforeEach(() => {
  localStorage.clear()
})

async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** The mock must behave like the host for the Phase F surface (Tasks 20–23). */
describe("MockBridge Phase F (Tasks 20–23)", () => {
  describe("Git", () => {
    it("clones with progress and creates a working repository", async () => {
      const bridge = new MockBridge()
      const progress: GitProgress[] = []

      const status = await bridge.gitClone(
        { url: "https://example.com/team/app.git", opId: "clone-1" },
        { onProgress: (event) => progress.push(event) }
      )

      expect(status).toMatchObject({ initialized: true, branch: "main", clean: true })
      expect(progress.length).toBeGreaterThan(0)
      expect(progress[progress.length - 1]).toMatchObject({ op: "clone", opId: "clone-1", done: 100, total: 100 })
      expect((await bridge.list("app")).map((entry) => entry.name)).toEqual(
        expect.arrayContaining(["README.md", "main.py"])
      )
    })

    it("accepts a commit and exposes it in the log and branches", async () => {
      const bridge = new MockBridge()
      await bridge.gitInit({ branch: "main" })
      await bridge.gitAdd(null, ["README.md"])

      const commit = await bridge.gitCommit({
        message: "first",
        authorName: "Phone User",
        authorEmail: "phone@example.com"
      })
      expect(commit.sha).toHaveLength(40)
      expect(commit.shortSha).toBe(commit.sha.slice(0, 7))

      await expect(bridge.gitCommit({ message: "empty" })).rejects.toMatchObject({
        code: "E_CONFLICT"
      })

      const log = await bridge.gitLog(null, 10)
      expect(log[0]!).toMatchObject({
        message: "first",
        author: "Phone User",
        email: "phone@example.com"
      })

      await bridge.gitBranchCreate({ name: "feature/x" })
      expect((await bridge.gitBranchList()).branches?.map((branch) => branch.name)).toContain(
        "feature/x"
      )
      const after = await bridge.gitCheckout({ name: "feature/x" })
      expect(after.branch).toBe("feature/x")
    })

    it("diffs the working tree and reports binary files", async () => {
      const bridge = new MockBridge()
      await bridge.gitInit({})
      await bridge.gitAdd(null, ["README.md"])
      await bridge.gitCommit({ message: "base" })

      await bridge.write("README.md", "changed line\n")
      const diff = await bridge.gitDiff({ file: "README.md" })
      expect(diff.binary).toBe(false)
      expect(diff.diff).toContain("+changed line")

      await bridge.write("blob.bin", "a\u0000b")
      const binary = await bridge.gitDiff({ file: "blob.bin" })
      expect(binary.binary).toBe(true)
      expect(binary.diff).toBe("")
    })

    it("stores a remote token but never returns its value", async () => {
      const bridge = new MockBridge()
      await bridge.gitInit({})

      const saved = await bridge.gitRemoteSet({
        name: "origin",
        url: "https://github.com/example/repo.git",
        authKind: "https",
        token: "ghp_secret"
      })
      expect(saved.remotes?.[0]).toMatchObject({ name: "origin", hasToken: true })
      expect(JSON.stringify(saved)).not.toContain("ghp_secret")

      const cleared = await bridge.gitRemoteSet({
        name: "origin",
        url: "https://github.com/example/repo.git",
        token: ""
      })
      expect(cleared.remotes?.[0].hasToken).toBe(false)
    })

    it("prompts for an unknown SSH host and rejects a refused key", async () => {
      const bridge = new MockBridge()
      const prompts: SshHostPrompt[] = []

      const cloning = bridge.gitClone(
        { url: "ssh://git@example.com/team/app.git", opId: "ssh-1" },
        { onHostKeyPrompt: (prompt) => prompts.push(prompt) }
      )

      await until(() => prompts.length === 1, "the host-key prompt")
      expect(prompts[0]).toMatchObject({ host: "example.com", port: 22, changed: false })
      expect(await bridge.sshHostKeyList()).toEqual([])

      await bridge.sshHostKeyAnswer(prompts[0].promptId, false, true)
      await expect(cloning).rejects.toMatchObject({ code: "E_AUTH" })
      expect(await bridge.sshHostKeyList()).toEqual([])
    })

    it("remembers a trusted SSH host key", async () => {
      const bridge = new MockBridge()
      let prompt: SshHostPrompt | null = null

      const cloning = bridge.gitClone(
        { url: "git@github.com:example/repo.git" },
        { onHostKeyPrompt: (event) => (prompt = event) }
      )
      await until(() => prompt !== null, "the host-key prompt")
      await bridge.sshHostKeyAnswer(prompt!.promptId, true, true)
      await cloning

      const hosts = await bridge.sshHostKeyList()
      expect(hosts).toHaveLength(1)
      expect(hosts[0]).toMatchObject({ host: "github.com", port: 22 })
      expect(hosts[0].fingerprint).toBe(prompt!.fingerprintSha256)

      // A second operation for the same host does not prompt again.
      const again = await bridge.gitFetch(
        { path: "repo", remote: "origin" },
        { onHostKeyPrompt: () => { throw new Error("must not prompt twice") } }
      )
      expect(again.branch).toBe("main")
    })

    it("cancels a running network operation through git.cancel", async () => {
      const bridge = new MockBridge()
      await bridge.gitInit({})
      await bridge.gitRemoteSet({
        name: "origin",
        url: "https://example.com/repo.git",
        authKind: "none"
      })

      let started = false
      const fetching = bridge.gitFetch(
        { remote: "origin", opId: "fetch-1" },
        {
          onProgress: () => {
            started = true
          }
        }
      )
      await until(() => started, "the first progress event")
      expect(await bridge.gitCancel("fetch-1")).toBe(true)

      await expect(fetching).rejects.toMatchObject({ code: "E_CANCELLED" })
      expect(await bridge.gitCancel("fetch-1")).toBe(false)
    })
  })

  describe("SSH keys", () => {
    it("generates and imports keys without exposing private material", async () => {
      const bridge = new MockBridge()

      const generated = await bridge.sshKeyGenerate({
        type: "ed25519",
        comment: "phone",
        passphrase: "hunter2",
        label: "Phone key"
      })
      expect(generated).toMatchObject({
        type: "ed25519",
        label: "Phone key",
        hasPassphrase: true
      })
      expect(generated.publicKey?.startsWith("ssh-ed25519 ")).toBe(true)
      expect(generated.fingerprint).toMatch(/^SHA256:/)
      expect(JSON.stringify(generated)).not.toContain("hunter2")

      const imported = await bridge.sshKeyImport({
        content: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample user@laptop",
        label: "Laptop"
      })
      expect(imported).toMatchObject({ type: "ed25519", label: "Laptop", hasPassphrase: false })

      expect(await bridge.sshKeysList()).toHaveLength(2)
      await bridge.sshKeyDelete(generated.id)
      expect((await bridge.sshKeysList()).map((key) => key.id)).toEqual([imported.id])
      await expect(bridge.sshKeyDelete("missing")).rejects.toMatchObject({ code: "E_NOT_FOUND" })
    })

    it("rejects unsupported key types and unreadable imports", async () => {
      const bridge = new MockBridge()
      await expect(bridge.sshKeyGenerate({ type: "dsa" })).rejects.toMatchObject({
        code: "E_UNSUPPORTED"
      })
      await expect(bridge.sshKeyGenerate({ type: "rsa", bits: 1024 })).rejects.toMatchObject({
        code: "E_BAD_ENVELOPE"
      })
      await expect(bridge.sshKeyImport({ content: "not a key" })).rejects.toMatchObject({
        code: "E_BAD_ENVELOPE"
      })
    })
  })

  describe("secrets", () => {
    it("stores tokens by host and lists only the host names", async () => {
      const bridge = new MockBridge()
      await bridge.secretsTokenSet("github.com", "ghp_secret")
      await bridge.secretsTokenSet("gitlab.com", "glpat_secret")

      const hosts = await bridge.secretsTokenList()
      expect(hosts.sort()).toEqual(["github.com", "gitlab.com"])
      expect(hosts.join()).not.toContain("secret")

      await bridge.secretsTokenDelete("github.com")
      expect(await bridge.secretsTokenList()).toEqual(["gitlab.com"])
      await expect(bridge.secretsTokenSet("", "x")).rejects.toMatchObject({
        code: "E_BAD_ENVELOPE"
      })
    })
  })
})
