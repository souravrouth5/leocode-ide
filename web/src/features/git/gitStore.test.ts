import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"

beforeEach(() => {
  localStorage.clear()
})

const lastNotice = (stores: ReturnType<typeof createAppStores>) => {
  const queue = stores.notifications.getState().queue
  return queue[queue.length - 1]
}

/** Wait until [check] is true, polling the microtask/timer queue. */
async function until(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

describe("Git store (Phase F, Tasks 21–23)", () => {
  it("initialises a workspace and reports the repository state", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.git.getState().refresh()
    expect(stores.git.getState().status?.initialized).toBe(false)

    const created = await stores.git.getState().init("main")

    expect(created).toBe(true)
    expect(stores.git.getState().status).toMatchObject({ initialized: true, branch: "main" })
    expect(lastNotice(stores)?.message).toBe("Repository initialised")
  })

  it("stages, commits with the settings identity and reloads history", async () => {
    const stores = createAppStores(new MockBridge())
    stores.settings.getState().update({ gitName: "Phone User", gitEmail: "phone@example.com" })
    await stores.git.getState().init()

    await stores.git.getState().refresh()
    const untracked = stores.git.getState().status?.untracked?.[0]
    expect(untracked).toBeTruthy()

    await stores.git.getState().stage([untracked!.path])
    expect(stores.git.getState().status?.staged).toHaveLength(1)

    const committed = await stores.git.getState().commit("first from the phone")
    expect(committed).toBe(true)
    expect(lastNotice(stores)?.message).toMatch(/^Committed [0-9a-f]{7}$/)

    await stores.git.getState().loadLog()
    const commit = stores.git.getState().log[0]
    expect(commit).toMatchObject({
      message: "first from the phone",
      author: "Phone User",
      email: "phone@example.com"
    })
  })

  it("refuses to commit without staged files or a message", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.git.getState().init()
    const spy = vi.spyOn(bridge, "gitCommit")

    expect(await stores.git.getState().commit("   ")).toBe(false)
    expect(await stores.git.getState().commit("message")).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    expect(lastNotice(stores)?.kind).toBe("warning")
  })

  it("loads history and branches when their tab opens, and switches branches", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.git.getState().init()

    stores.git.getState().setTab("branches")
    await until(() => stores.git.getState().branches.length > 0, "branches")

    expect(await stores.git.getState().createBranch("feature/x")).toBe(true)
    expect(stores.git.getState().branches.map((branch) => branch.name)).toContain("feature/x")

    expect(await stores.git.getState().checkout("feature/x")).toBe(true)
    expect(stores.git.getState().status?.branch).toBe("feature/x")
  })

  it("stores a token once and only ever lists hasToken", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.git.getState().init()

    const saved = await stores.git.getState().saveRemote({
      name: "origin",
      url: "https://github.com/example/repo.git",
      authKind: "https",
      username: "x-access-token",
      token: "ghp_super_secret"
    })
    expect(saved).toBe(true)

    const remote = stores.git.getState().remotes[0]
    expect(remote).toMatchObject({ name: "origin", hasToken: true, authKind: "https" })
    expect(JSON.stringify(remote)).not.toContain("ghp_super_secret")
    expect(JSON.stringify(stores.git.getState())).not.toContain("ghp_super_secret")

    // Saving again without a token keeps the stored one.
    await stores.git.getState().saveRemote({
      name: "origin",
      url: "https://github.com/example/repo.git",
      authKind: "https",
      token: null
    })
    expect(stores.git.getState().remotes[0].hasToken).toBe(true)
  })

  it("streams fetch progress and settles the busy state", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.git.getState().init()
    await stores.git.getState().saveRemote({
      name: "origin",
      url: "https://example.com/repo.git",
      authKind: "https"
    })
    const seen: string[] = []
    const unsubscribe = stores.git.subscribe((state) => {
      if (state.progress) seen.push(`${state.progress.done}/${state.progress.total}`)
    })

    await stores.git.getState().fetch()
    unsubscribe()

    expect(seen.length).toBeGreaterThan(0)
    expect(stores.git.getState().busy).toBe(false)
    expect(stores.git.getState().progress).toBeNull()
    expect(lastNotice(stores)?.message).toContain("Fetched")
  })

  it("asks for an unknown SSH host key and remembers a trusted key", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.git.getState().init()
    await stores.git.getState().generateKey({ type: "ed25519", label: "Phone" })
    const key = stores.git.getState().sshKeys[0]
    await stores.git.getState().saveRemote({
      name: "origin",
      url: "ssh://git@example.com/repo.git",
      authKind: "ssh",
      keyId: key.id
    })

    const pushing = stores.git.getState().push()
    await until(() => stores.git.getState().hostPrompt !== null, "host prompt")

    const prompt = stores.git.getState().hostPrompt!
    expect(prompt).toMatchObject({ host: "example.com", port: 22, keyType: "ssh-ed25519" })
    expect(prompt.fingerprintSha256).toMatch(/^SHA256:/)

    await stores.git.getState().answerHostPrompt(true, true)
    await pushing

    await stores.git.getState().loadKnownHosts()
    expect(stores.git.getState().knownHosts[0]).toMatchObject({ host: "example.com", port: 22 })
  })

  it("cancels a running push with its operation id", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.git.getState().init()
    await stores.git.getState().saveRemote({
      name: "origin",
      url: "https://example.com/repo.git",
      authKind: "none"
    })

    const pushing = stores.git.getState().push()
    await until(() => stores.git.getState().opId !== null, "an operation id")
    await stores.git.getState().cancel()
    await pushing

    expect(stores.git.getState().busy).toBe(false)
    expect(lastNotice(stores)?.message).toBe("Git push cancelled")
  })

  it("drops workspace-scoped state when the workspace switches", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.git.getState().init()
    stores.git.setState({ diff: { diff: "x" }, tab: "history" })

    window.dispatchEvent(new CustomEvent("leocode:workspace-switched"))

    expect(stores.git.getState().status).toBeNull()
    expect(stores.git.getState().tab).toBe("changes")
    expect(stores.git.getState().diff).toBeNull()
  })
})
