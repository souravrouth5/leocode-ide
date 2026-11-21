import { createStore, type StoreApi } from "zustand/vanilla"
import {
  AppError,
  type Bridge,
  type GitAuth,
  type GitBranch,
  type GitCommitEntry,
  type GitConflict,
  type GitDiff,
  type GitProgress,
  type GitRemote,
  type GitResolveStrategy,
  type GitStatus,
  type GitStream,
  type SshHostPrompt,
  type SshKey,
  type SshKnownHost
} from "../../bridge"
import type { ErrorsState } from "../../errors/errorsStore"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { DialogState } from "../dialogs/dialogStore"
import type { SettingsStore } from "../settings/settingsStore"

export type GitTab = "changes" | "history" | "branches"

export type GitNetworkOp = "clone" | "fetch" | "pull" | "push"

export interface RemoteInput {
  name: string
  url: string
  authKind?: string | null
  username?: string | null
  /** Write-only: the host stores it and never sends it back. */
  token?: string | null
  keyId?: string | null
}

export interface SshKeyInput {
  type?: string | null
  comment?: string | null
  passphrase?: string | null
  label?: string | null
  bits?: number | null
}

export interface GitState {
  /** `null` until the first status reply; `initialized: false` means no repo. */
  status: GitStatus | null
  tab: GitTab
  log: GitCommitEntry[]
  branches: GitBranch[]
  currentBranch: string
  remotes: GitRemote[]
  currentRemote: string | null
  sshKeys: SshKey[]
  knownHosts: SshKnownHost[]
  diff: GitDiff | null
  conflict: GitConflict | null
  progress: GitProgress | null
  /** The SSH host key the host is waiting on. */
  hostPrompt: SshHostPrompt | null
  /** A Git request is in flight. */
  busy: boolean
  /** The id of the running network operation; `git.cancel` stops it. */
  opId: string | null
  sshSheetOpen: boolean
  remoteSheetOpen: boolean

  setTab(tab: GitTab): void
  refresh(): Promise<void>
  init(branch?: string): Promise<boolean>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  commit(message: string): Promise<boolean>
  loadLog(): Promise<void>
  loadBranches(): Promise<void>
  createBranch(name: string): Promise<boolean>
  deleteBranch(name: string): Promise<boolean>
  checkout(name: string, create?: boolean): Promise<boolean>
  openDiff(file: string, staged?: boolean): Promise<void>
  closeDiff(): void
  openConflict(file: string): Promise<void>
  closeConflict(): void
  /** Whole-file resolution: the host takes `ours` or `theirs`. */
  resolveFile(strategy: GitResolveStrategy): Promise<boolean>
  /** Per-block resolution: write the merged text, then stage the file. */
  saveConflict(content: string): Promise<boolean>
  loadRemotes(): Promise<void>
  openRemotes(): Promise<void>
  closeRemotes(): void
  saveRemote(input: RemoteInput): Promise<boolean>
  removeRemote(name: string): Promise<boolean>
  fetch(): Promise<void>
  pull(): Promise<void>
  push(): Promise<void>
  clone(url: string, path?: string): Promise<boolean>
  cancel(): Promise<void>
  loadSshKeys(): Promise<void>
  openSshKeys(): Promise<void>
  closeSshKeys(): void
  generateKey(input: SshKeyInput): Promise<boolean>
  importKey(content: string, passphrase?: string, label?: string): Promise<boolean>
  deleteKey(id: string): Promise<boolean>
  loadKnownHosts(): Promise<void>
  forgetHost(host: string, port?: number): Promise<boolean>
  answerHostPrompt(trust: boolean, remember?: boolean): Promise<void>
  /** Drop the workspace-scoped state after a workspace switch. */
  reset(): void
}

export interface GitDeps {
  bridge: Bridge
  settings: SettingsStore
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
  dialogs: StoreApi<DialogState>
}

export type GitStore = StoreApi<GitState> & { dispose(): void }

let opSequence = 0

/** Client-generated id: `git.cancel` stops the operation that owns it. */
function nextOpId(): string {
  opSequence += 1
  return `git-op-${Date.now()}-${opSequence}`
}

/** The repository lives at the workspace root; `null` means "the root". */
const ROOT = null

/**
 * The Git feature (Phase F, Tasks 21–23).
 *
 * One store owns the repository state, the view tab, the network progress and
 * the SSH host-key prompt. Every failure is reported through `errors` (with the
 * catalog's surface) and every success through `notifications`, so no component
 * has to invent its own error handling.
 *
 * Secrets never come back from the host: a remote reports `hasToken` only, and
 * the token typed into the remote sheet is sent once and forgotten.
 */
export function createGitStore(deps: GitDeps): GitStore {
  const { bridge, settings, notifications, errors, dialogs } = deps

  const report = (error: unknown, context: string) => {
    errors.getState().report(error, { context })
  }

  const notify = (
    message: string,
    kind: "info" | "success" | "warning" = "success",
    durationMs = 3_500
  ) => {
    notifications.getState().enqueue({ kind, message, durationMs })
  }

  const store = createStore<GitState>((set, get) => {
    /** The stream callbacks shared by clone/fetch/pull/push. */
    const stream = (): GitStream => ({
      onProgress: (progress) => set({ progress }),
      onHostKeyPrompt: (prompt) => set({ hostPrompt: prompt })
    })

    /** Run a network operation with progress and a cancel handle. */
    const runNetwork = async (
      op: "fetch" | "pull" | "push",
      request: { remote?: string | null; branch?: string | null }
    ): Promise<void> => {
      if (get().remotes.length === 0) await get().loadRemotes()
      const remoteName = request.remote ?? get().currentRemote
      const remote = get().remotes.find((item) => item.name === remoteName)
      // A passphrase-protected key is only used for this request; the passphrase
      // is never written to the store or the host.
      let auth: GitAuth | null = null
      if (remote?.authKind === "ssh" && remote.keyId) {
        const key = get().sshKeys.find((item) => item.id === remote.keyId)
        if (key?.hasPassphrase) {
          const passphrase = await dialogs.getState().prompt({
            title: "SSH key passphrase",
            label: `Passphrase for ${key.label}`,
            placeholder: "Unlocks the key for this operation only",
            secret: true,
            trim: false,
            confirmLabel: "Use key"
          })
          if (passphrase === null) return
          auth = { kind: "ssh", keyId: remote.keyId, passphrase }
        }
      }

      const opId = nextOpId()
      set({ busy: true, opId, progress: null })
      const events = stream()
      try {
        const reply =
          op === "fetch"
            ? await bridge.gitFetch({ path: ROOT, opId, auth, ...request }, events)
            : op === "pull"
              ? await bridge.gitPull({ path: ROOT, opId, auth, ...request }, events)
              : await bridge.gitPush({ path: ROOT, opId, auth, ...request }, events)
        await get().refresh()
        notify(reply.message?.trim() || `Git ${op} finished`)
      } catch (error) {
        if (error instanceof AppError && error.code === "E_CANCELLED") {
          notify(`Git ${op} cancelled`, "info")
        } else {
          report(error, `Git ${op}`)
        }
      } finally {
        set({ busy: false, opId: null, progress: null })
      }
    }

    return {
      status: null,
      tab: "changes",
      log: [],
      branches: [],
      currentBranch: "",
      remotes: [],
      currentRemote: null,
      sshKeys: [],
      knownHosts: [],
      diff: null,
      conflict: null,
      progress: null,
      hostPrompt: null,
      busy: false,
      opId: null,
      sshSheetOpen: false,
      remoteSheetOpen: false,

      setTab(tab) {
        set({ tab })
        if (tab === "history") void get().loadLog()
        if (tab === "branches") void get().loadBranches()
      },

      async refresh() {
        try {
          const status = await bridge.gitStatus(ROOT)
          set({ status })
        } catch (error) {
          report(error, "Git status")
        }
      },

      async init(branch) {
        if (get().busy) return false
        set({ busy: true })
        try {
          const status = await bridge.gitInit({
            path: ROOT,
            branch: branch?.trim() ? branch.trim() : null
          })
          set({ status })
          notify("Repository initialised")
          return true
        } catch (error) {
          report(error, "Initialize repository")
          return false
        } finally {
          set({ busy: false })
        }
      },

      async stage(paths) {
        const list = paths.filter(Boolean)
        if (list.length === 0) return
        try {
          const status = await bridge.gitAdd(ROOT, list)
          set({ status })
        } catch (error) {
          report(error, "Stage changes")
        }
      },

      async unstage(paths) {
        const list = paths.filter(Boolean)
        if (list.length === 0) return
        try {
          const status = await bridge.gitReset(ROOT, list)
          set({ status })
        } catch (error) {
          report(error, "Unstage changes")
        }
      },

      async commit(message) {
        const text = message.trim()
        const staged = get().status?.staged ?? []
        if (!text) {
          notify("A commit needs a message", "warning")
          return false
        }
        if (staged.length === 0) {
          notify("Stage a file before committing", "warning")
          return false
        }
        const user = settings.getState().settings
        try {
          const result = await bridge.gitCommit({
            path: ROOT,
            message: text,
            authorName: user.gitName.trim() ? user.gitName.trim() : null,
            authorEmail: user.gitEmail.trim() ? user.gitEmail.trim() : null
          })
          await get().refresh()
          notify(`Committed ${result.shortSha}`)
          return true
        } catch (error) {
          report(error, "Commit")
          return false
        }
      },

      async loadLog() {
        try {
          set({ log: await bridge.gitLog(ROOT, 50) })
        } catch (error) {
          report(error, "Git history")
        }
      },

      async loadBranches() {
        try {
          const reply = await bridge.gitBranchList(ROOT)
          set({
            branches: reply.branches ?? [],
            currentBranch: reply.current ?? ""
          })
        } catch (error) {
          report(error, "Branches")
        }
      },

      async createBranch(name) {
        const trimmed = name.trim()
        if (!trimmed) {
          notify("A branch needs a name", "warning")
          return false
        }
        try {
          const status = await bridge.gitBranchCreate({
            path: ROOT,
            name: trimmed,
            startPoint: null
          })
          set({ status })
          await get().loadBranches()
          notify(`Branch ${trimmed} created`)
          return true
        } catch (error) {
          report(error, "Create branch")
          return false
        }
      },

      async deleteBranch(name) {
        const confirmed = await dialogs.getState().confirm({
          title: "Delete branch",
          message: `Delete the branch “${name}”?`,
          detail: "Commits that are only on that branch become unreachable.",
          confirmLabel: "Delete",
          danger: true
        })
        if (!confirmed) return false
        try {
          const status = await bridge.gitBranchDelete(ROOT, name)
          set({ status })
          await get().loadBranches()
          notify(`Branch ${name} deleted`)
          return true
        } catch (error) {
          report(error, "Delete branch")
          return false
        }
      },

      async checkout(name, create = false) {
        const trimmed = name.trim()
        if (!trimmed) return false
        try {
          const status = await bridge.gitCheckout({
            path: ROOT,
            name: trimmed,
            create
          })
          set({ status })
          await get().loadBranches()
          notify(`Switched to ${trimmed}`)
          return true
        } catch (error) {
          report(error, "Checkout branch")
          return false
        }
      },

      async openDiff(file, staged = false) {
        try {
          const diff = await bridge.gitDiff({ path: ROOT, file, staged })
          set({ diff })
        } catch (error) {
          report(error, "Diff")
        }
      },

      closeDiff() {
        set({ diff: null })
      },

      async openConflict(file) {
        try {
          const conflict = await bridge.gitConflict(ROOT, file)
          set({ conflict })
        } catch (error) {
          report(error, "Conflict")
        }
      },

      closeConflict() {
        set({ conflict: null })
      },

      async resolveFile(strategy) {
        const conflict = get().conflict
        if (!conflict) return false
        try {
          const status = await bridge.gitResolve(ROOT, conflict.file, strategy)
          set({ status, conflict: null })
          notify(
            strategy === "ours"
              ? `Kept your version of ${conflict.file}`
              : `Kept the incoming version of ${conflict.file}`
          )
          return true
        } catch (error) {
          report(error, "Resolve conflict")
          return false
        }
      },

      async saveConflict(content) {
        const conflict = get().conflict
        if (!conflict) return false
        try {
          // The plan's rule: write the merged text first, then stage it.
          await bridge.write(conflict.file, content)
          const status = await bridge.gitAdd(ROOT, [conflict.file])
          set({ status, conflict: null })
          notify(`Resolved ${conflict.file}`)
          return true
        } catch (error) {
          report(error, "Resolve conflict")
          return false
        }
      },

      async loadRemotes() {
        try {
          const reply = await bridge.gitRemoteList(ROOT)
          set({
            remotes: reply.remotes ?? [],
            currentRemote: reply.current ?? null
          })
        } catch (error) {
          report(error, "Remotes")
        }
      },

      async openRemotes() {
        set({ remoteSheetOpen: true })
        await get().loadRemotes()
      },

      closeRemotes() {
        set({ remoteSheetOpen: false })
      },

      async saveRemote(input) {
        const name = input.name.trim()
        const url = input.url.trim()
        if (!name) {
          notify("A remote needs a name", "warning")
          return false
        }
        if (!url) {
          notify("A remote needs a URL", "warning")
          return false
        }
        try {
          const reply = await bridge.gitRemoteSet({
            path: ROOT,
            name,
            url,
            authKind: input.authKind ?? null,
            username: input.username ?? null,
            // The token is sent once; the host stores it and never returns it.
            token: input.token ? input.token : null,
            keyId: input.keyId ?? null
          })
          set({ remotes: reply.remotes ?? [] })
          notify(`Remote ${name} saved`)
          return true
        } catch (error) {
          report(error, "Remote")
          return false
        }
      },

      async removeRemote(name) {
        const confirmed = await dialogs.getState().confirm({
          title: "Remove remote",
          message: `Remove the remote “${name}”?`,
          detail: "The saved token for this remote is deleted too.",
          confirmLabel: "Remove",
          danger: true
        })
        if (!confirmed) return false
        try {
          const reply = await bridge.gitRemoteRemove(ROOT, name)
          set({
            remotes: reply.remotes ?? [],
            currentRemote: reply.current ?? null
          })
          notify(`Remote ${name} removed`)
          return true
        } catch (error) {
          report(error, "Remove remote")
          return false
        }
      },

      async fetch() {
        await runNetwork("fetch", { remote: get().currentRemote })
      },

      async pull() {
        await runNetwork("pull", { remote: get().currentRemote })
      },

      async push() {
        await runNetwork("push", { remote: get().currentRemote })
      },

      async clone(url, path) {
        const trimmed = url.trim()
        if (!trimmed) {
          notify("A clone needs a URL", "warning")
          return false
        }
        const opId = nextOpId()
        set({ busy: true, opId, progress: null })
        const events = stream()
        try {
          const status = await bridge.gitClone(
            {
              url: trimmed,
              path: path?.trim() ? path.trim() : null,
              name: null,
              auth: null,
              opId
            },
            events
          )
          set({ status })
          notify("Repository cloned")
          return true
        } catch (error) {
          if (error instanceof AppError && error.code === "E_CANCELLED") {
            notify("Clone cancelled", "info")
          } else {
            report(error, "Clone repository")
          }
          return false
        } finally {
          set({ busy: false, opId: null, progress: null })
        }
      },

      async cancel() {
        const opId = get().opId
        if (!opId) return
        try {
          await bridge.gitCancel(opId)
        } catch (error) {
          report(error, "Cancel Git operation")
        }
      },

      async loadSshKeys() {
        try {
          set({ sshKeys: await bridge.sshKeysList() })
        } catch (error) {
          report(error, "SSH keys")
        }
      },

      async openSshKeys() {
        set({ sshSheetOpen: true })
        await get().loadSshKeys()
        await get().loadKnownHosts()
      },

      closeSshKeys() {
        set({ sshSheetOpen: false })
      },

      async generateKey(input) {
        try {
          const key = await bridge.sshKeyGenerate({
            type: input.type ?? "ed25519",
            comment: input.comment?.trim() ? input.comment.trim() : null,
            passphrase: input.passphrase ? input.passphrase : null,
            label: input.label?.trim() ? input.label.trim() : null,
            bits: input.bits ?? undefined
          })
          await get().loadSshKeys()
          notify(`SSH key ${key.label} created`)
          return true
        } catch (error) {
          report(error, "Generate SSH key")
          return false
        }
      },

      async importKey(content, passphrase, label) {
        const text = content.trim()
        if (!text) {
          notify("Paste the private key first", "warning")
          return false
        }
        try {
          const key = await bridge.sshKeyImport({
            content: text,
            passphrase: passphrase ? passphrase : null,
            label: label?.trim() ? label.trim() : null
          })
          await get().loadSshKeys()
          notify(`SSH key ${key.label} imported`)
          return true
        } catch (error) {
          report(error, "Import SSH key")
          return false
        }
      },

      async deleteKey(id) {
        const confirmed = await dialogs.getState().confirm({
          title: "Delete SSH key",
          message: "Delete this SSH key?",
          detail: "The private key is removed from the device and cannot be restored.",
          confirmLabel: "Delete",
          danger: true
        })
        if (!confirmed) return false
        try {
          await bridge.sshKeyDelete(id)
          await get().loadSshKeys()
          notify("SSH key deleted")
          return true
        } catch (error) {
          report(error, "Delete SSH key")
          return false
        }
      },

      async loadKnownHosts() {
        try {
          set({ knownHosts: await bridge.sshHostKeyList() })
        } catch (error) {
          report(error, "Known hosts")
        }
      },

      async forgetHost(host, port = 22) {
        const confirmed = await dialogs.getState().confirm({
          title: "Forget host key",
          message: `Forget the key of ${host}?`,
          detail: "The next connection asks for the host key again.",
          confirmLabel: "Forget",
          danger: true
        })
        if (!confirmed) return false
        try {
          await bridge.sshHostKeyDelete(host, port)
          await get().loadKnownHosts()
          notify(`Forgot the key of ${host}`)
          return true
        } catch (error) {
          report(error, "Forget host key")
          return false
        }
      },

      async answerHostPrompt(trust, remember = true) {
        const prompt = get().hostPrompt
        if (!prompt) return
        try {
          await bridge.sshHostKeyAnswer(prompt.promptId, trust, remember)
        } catch (error) {
          report(error, "Host key")
        } finally {
          set({ hostPrompt: null })
        }
      },

      reset() {
        set({
          status: null,
          tab: "changes",
          log: [],
          branches: [],
          currentBranch: "",
          remotes: [],
          currentRemote: null,
          diff: null,
          conflict: null,
          progress: null,
          hostPrompt: null,
          busy: false,
          opId: null,
          sshSheetOpen: false,
          remoteSheetOpen: false
        })
      }
    }
  })

  // A workspace switch invalidates every path the store holds (PD-14).
  const onWorkspaceSwitched = () => {
    store.getState().reset()
    void store.getState().refresh()
  }
  if (typeof window !== "undefined") {
    window.addEventListener("leocode:workspace-switched", onWorkspaceSwitched)
  }

  const api = store as GitStore
  api.dispose = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("leocode:workspace-switched", onWorkspaceSwitched)
    }
  }
  return api
}
