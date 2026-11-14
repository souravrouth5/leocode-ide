import { beforeEach, describe, expect, it } from "vitest"
import { MockBridge } from "./mock"
import type { SearchMatch } from "./types"

beforeEach(() => {
  localStorage.clear()
})

/** Task 14–16: the mock must behave like the host for the new bridge surface. */
describe("MockBridge Phase D (Tasks 14–16)", () => {
  describe("stat, chunked reads and compare-and-swap writes", () => {
    it("reports the same hash from stat and writeChecked", async () => {
      const bridge = new MockBridge()
      await bridge.write("note.txt", "hello")

      const stat = await bridge.stat("note.txt")
      expect(stat).toMatchObject({ path: "note.txt", kind: "file", size: 5 })
      expect(stat.hash).toMatch(/^[0-9a-f]{64}$/)

      const written = await bridge.writeChecked("note.txt", "hello", stat.hash)
      expect(written.hash).toBe(stat.hash)
      expect(written.size).toBe(5)
      expect(written.mtime).toBeGreaterThan(0)
    })

    it("rejects a stale baseline with E_CONFLICT and keeps the disk text", async () => {
      const bridge = new MockBridge()
      await bridge.write("note.txt", "one")
      const before = await bridge.stat("note.txt")
      await bridge.write("note.txt", "theirs")

      await expect(bridge.writeChecked("note.txt", "mine", before.hash)).rejects.toMatchObject({
        code: "E_CONFLICT"
      })
      expect(await bridge.read("note.txt")).toBe("theirs")
    })

    it("reads large files in byte offset chunks until nextOffset is -1", async () => {
      const bridge = new MockBridge()
      await bridge.write("chunked.txt", "abcdefghij")

      const first = await bridge.readChunk("chunked.txt", 0, 4)
      expect(first).toMatchObject({ content: "abcd", size: 10, nextOffset: 4 })

      const second = await bridge.readChunk("chunked.txt", first.nextOffset, 4)
      expect(second).toMatchObject({ content: "efgh", nextOffset: 8 })

      const last = await bridge.readChunk("chunked.txt", second.nextOffset, 4)
      expect(last).toMatchObject({ content: "ij", nextOffset: -1 })
      expect(last.hash).toBe((await bridge.stat("chunked.txt")).hash)
    })

    it("reports folders and missing paths like the host", async () => {
      const bridge = new MockBridge()

      await expect(bridge.stat("src")).resolves.toMatchObject({ kind: "dir", size: 0 })
      await expect(bridge.readChunk("src", 0, 10)).rejects.toMatchObject({ code: "E_NOT_DIR" })
      await expect(bridge.stat("nope.txt")).rejects.toMatchObject({ code: "E_NOT_FOUND" })
    })
  })

  describe("workspace lifecycle", () => {
    it("creates, renames, opens and deletes a workspace", async () => {
      const bridge = new MockBridge()
      const initial = await bridge.listWorkspaces()
      expect(initial.active).toBe("default")
      expect(initial.workspaces.map((item) => item.id)).toEqual(["default"])

      const created = await bridge.createWorkspace("  Notes  ")
      expect(created).toMatchObject({ name: "Notes" })
      expect(created.id).not.toBe("default")

      await bridge.renameWorkspace(created.id, "Journal")
      const renamed = (await bridge.listWorkspaces()).workspaces.find(
        (item) => item.id === created.id
      )
      expect(renamed?.name).toBe("Journal")

      await bridge.openWorkspace(created.id)
      expect((await bridge.listWorkspaces()).active).toBe(created.id)

      await bridge.deleteWorkspace(created.id)
      const after = await bridge.listWorkspaces()
      expect(after.active).toBe("default")
      expect(after.workspaces.map((item) => item.id)).toEqual(["default"])
    })

    it("never deletes the default workspace", async () => {
      const bridge = new MockBridge()

      await expect(bridge.deleteWorkspace("default")).rejects.toMatchObject({
        code: "E_PERMISSION"
      })
      await expect(bridge.openWorkspace("missing")).rejects.toMatchObject({
        code: "E_NOT_FOUND"
      })
    })

    it("keeps drafts separate per workspace", async () => {
      const bridge = new MockBridge()
      await bridge.saveDraft("a.txt", "default draft", "\n")

      const created = await bridge.createWorkspace("Other")
      await bridge.openWorkspace(created.id)
      expect(await bridge.listDrafts()).toEqual([])
      await bridge.saveDraft("a.txt", "other draft", "\r\n")

      await bridge.openWorkspace("default")
      expect((await bridge.readDraft("a.txt"))?.content).toBe("default draft")

      await bridge.openWorkspace(created.id)
      const other = await bridge.readDraft("a.txt")
      expect(other).toMatchObject({ content: "other draft", eol: "\r\n" })
      const drafts = await bridge.listDrafts()
      expect(drafts).toHaveLength(1)
      expect(drafts[0].size).toBe(new TextEncoder().encode("other draft").length)
    })
  })

  describe("drafts", () => {
    it("saves, lists and deletes a draft", async () => {
      const bridge = new MockBridge()
      expect(await bridge.readDraft("a.txt")).toBeNull()

      await bridge.saveDraft("a.txt", "unsaved", "\n")
      const draft = await bridge.readDraft("a.txt")
      expect(draft).toMatchObject({ path: "a.txt", content: "unsaved", eol: "\n" })
      expect(await bridge.listDrafts()).toHaveLength(1)

      await bridge.deleteDraft("a.txt")
      expect(await bridge.readDraft("a.txt")).toBeNull()
      expect(await bridge.listDrafts()).toEqual([])
    })
  })

  describe("workspace search", () => {
    const collect = async (
      bridge: MockBridge,
      query: string,
      options: Parameters<MockBridge["search"]>[1] = {},
      onMatch: (match: SearchMatch) => void = () => {}
    ) => {
      const matches: SearchMatch[] = []
      const summary = await bridge.search(query, options, (match) => {
        matches.push(match)
        onMatch(match)
      })
      return { matches, summary }
    }

    it("streams every match before the summary arrives", async () => {
      const bridge = new MockBridge()
      const { matches, summary } = await collect(bridge, "print")

      expect(summary.count).toBeGreaterThan(0)
      expect(summary.truncated).toBe(false)
      expect(matches).toHaveLength(summary.count)
      for (const match of matches) {
        expect(match.line).toBeGreaterThan(0)
        expect(match.col).toBeGreaterThan(0)
        expect(match.preview.length).toBeLessThanOrEqual(240)
      }
    })

    it("applies the glob, the case flag and the ignore list", async () => {
      const bridge = new MockBridge()
      await bridge.mkdir(".git")
      await bridge.write(".git/config", "print('ignored')\n")

      const python = await collect(bridge, "print", { glob: "*.py" })
      expect(python.matches.length).toBeGreaterThan(0)
      expect(python.matches.every((match) => match.path.endsWith(".py"))).toBe(true)

      expect((await collect(bridge, "PRINT", { caseSensitive: true })).summary.count).toBe(0)
      expect(
        (await collect(bridge, "ignored", { caseSensitive: true })).summary.count
      ).toBe(0)
    })

    it("caps results and reports truncation", async () => {
      const bridge = new MockBridge()
      await bridge.write("extra.py", "print(1)\nprint(2)\n")
      const { matches, summary } = await collect(bridge, "print", { maxResults: 1 })

      expect(summary).toEqual({ count: 1, truncated: true })
      expect(matches).toHaveLength(1)
    })

    it("stops after the client cancels the search id", async () => {
      const bridge = new MockBridge()
      await bridge.write("a.txt", "needle\n")
      await bridge.write("b.txt", "needle\n")

      const seen: SearchMatch[] = []
      const summary = await bridge.search("needle", { searchId: "run-1" }, (match) => {
        seen.push(match)
        // `cancelSearch` has no await before it flips the flag, so the next
        // file iteration sees the cancellation.
        if (seen.length === 1) void bridge.cancelSearch("run-1")
      })

      expect(summary.truncated).toBe(true)
      expect(seen).toHaveLength(1)
      await expect(bridge.cancelSearch("run-1")).resolves.toBe(false)
    })
  })

  describe("import, export and restore", () => {
    it("copies an imported tree without overwriting existing names", async () => {
      const bridge = new MockBridge()
      const progress: number[] = []

      const result = await bridge.importTree("imports", (event) =>
        progress.push(event.files)
      )

      expect(result).toMatchObject({ path: "imports", files: 2 })
      expect(progress[progress.length - 1]).toBe(2)
      expect(await bridge.read("imports/hello.py")).toContain("imported")
      // The existing top-level file is untouched by an import into the root.
      expect(await bridge.read("main.py")).toContain("LeoCode mock workspace")
    })

    it("exports a backup with progress and restores it", async () => {
      const bridge = new MockBridge()
      const events: string[] = []

      const exported = await bridge.exportWorkspace("backup.zip", (event) =>
        events.push(`${event.phase}:${event.files}`)
      )
      expect(exported).toMatchObject({ name: "backup.zip" })
      expect(exported!.files).toBeGreaterThan(0)
      expect(events[0]).toMatch(/^export:1$/)

      const restored = await bridge.restoreArchive((event) => events.push(event.phase))
      expect(restored).toMatchObject({ files: 1 })
      expect(await bridge.read("restored/README.md")).toContain("Restored backup")
    })
  })
})
