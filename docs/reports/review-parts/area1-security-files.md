# Path jail, file safety and storage handling (Tasks 4-6), review area 1

Review of the bridge file layer on branch v9-impl (HEAD 4389983): `PathJail`, `AtomicWriter`, `Trash`, `FsHandler`, `SafHandler`, the SAF and permission code in `MainActivity`, manifests, CSP and the `RuntimeInstaller` extraction path. Read-only; nothing was built or run, so every finding is from reading code and docs. Items marked SUSPECTED name the device check that would settle them.

The jail itself is sound: every path-taking handler (`fs.*`, `proc.run` cwd, `term.open` cwd) resolves through `PathJail.resolve`, comparison is canonical with a `root + "/"` prefix, and shared storage is gated on a live permission check. The problems are in what happens after the jail says yes. The trash can permanently delete files it was supposed to keep, `fs.delete` and `fs.rename` follow symlinks to their targets, and several read/write paths have unhandled edge cases (FIFO, invalid UTF-8, lost executable bit, SAF read thread crash).

Watch for: (1) trash purge keys on the original mtime, so an old file is permanently deleted at the next delete (confirmed); (2) deleting `/sdcard/.leocode-trash` moves it into itself and falls into unbounded recursion (confirmed by reading); (3) `fs.read` on a FIFO in the workspace hangs a bridge thread forever (confirmed); (4) `rel()` may return absolute paths on real devices because `/data/user/0` canonicalises to `/data/data` (suspected, one `fs.list` on a device settles it); (5) SAF read thread has no exception handling and can crash the app (confirmed).

**Verdict**: NEEDS_CHANGES

## High-level view

The jail design is correct and consistently applied. All entry points that accept a path or cwd go through one resolver, roots are canonicalised, the prefix check is separator-aware, and the shared-storage root is re-checked on every call. Residual risk is the unavoidable check-then-act window, which only matters against code that already runs as the app's uid (the terminal), so it is not a boundary.

Deletion is where the claims and the code diverge. The docs say the bridge never permanently deletes, but `Trash.purge` runs on every delete and decides age from `lastModified`, which a rename preserves. Files last edited more than 30 days ago are destroyed by the next delete call. Separately, the shared trash is a visible, jailed, deletable directory under `/sdcard`, and deleting it is not handled.

Because `PathJail` returns canonical paths, `fs.delete` and `fs.rename` act on a symlink's target, not the link. That is surprising for users and leaves dangling links, and it also means a link pointing outside the jail cannot be removed through the bridge at all.

`AtomicWriter` does what it says for content (temp file, fsync, rename), but it drops permissions, never fsyncs the directory, and leaves visible `.tmp` files after a crash. Read and write limits are asymmetric (write 4 MB, read 2 MB), and invalid UTF-8 is silently replaced on read, so a save after open can corrupt the file.

The SAF flow works on the happy path. Failures in the document read thread and in the save write are not reported to the user: the first crashes the process, the second reports success.

Manifests, WebView settings and CSP are in good shape for a debug-only dev surface. The remaining items are minor.

<details>
<summary>Issues (20)</summary>

1. **S-01 Trash purge deletes old files immediately** (High, confirmed) — `Trash.purge` ages entries by `lastModified`, which `renameTo` preserves. Record the trash time (encoded in the entry name, which already begins with `$now-`) and purge on that, or `setLastModified(now)` after the move.
2. **S-02 Deleting the shared trash recurses into itself** (High, confirmed by reading) — `fs.delete("/sdcard/.leocode-trash")` is not protected. Add the trash dirs to the protected set and hide `.leocode-trash` from `fs.list`.
3. **S-03 fs.read on a FIFO blocks forever** (Medium, confirmed) — reject non-regular files with `Files.isRegularFile` before reading.
4. **S-04 rel() likely returns absolute paths on device** (Medium, suspected) — canonical `/data/data/...` vs `filesDir` `/data/user/0/...`. Canonicalise the workspace root in `rel()`.
5. **S-05 fs.delete and fs.rename act on symlink targets** (Medium, confirmed) — resolve the parent canonically and keep the final component un-resolved for delete/rename.
6. **S-06 Trash entry name can exceed 255 bytes** (Medium, confirmed) — files with names over about 200 bytes cannot be deleted. Truncate the original name in the entry.
7. **S-07 AtomicWriter drops file mode** (Medium, confirmed) — copy POSIX permissions from the existing target to the temp file before rename.
8. **S-08 Invalid UTF-8 silently replaced on read** (Medium, confirmed) — decode with a strict decoder and return `E_BINARY` (or a flag) on malformed input.
9. **S-09 Read/write limit asymmetry** (Medium, confirmed) — a 3 MB write succeeds, then the file cannot be opened. Align the limits or implement the documented chunked read.
10. **S-10 SAF read thread has no error handling** (Medium, confirmed) — wrap the worker in try/catch and reply with `E_IO`.
11. **S-11 SAF save reports success when the write fails** (Medium, confirmed) — `runCatching` swallows the failure and the callback still returns the URI.
12. **S-12 Case-only rename impossible on case-insensitive storage** (Medium, likely) — `to.exists()` is true for `A.txt` vs `a.txt` on sdcardfs/FUSE. Allow when canonical `from` and `to` are the same inode.
13. **S-13 Rename of the default workspace is allowed** (Medium, confirmed) — `workspaces/default` can be renamed, after which the app has no workspace until restart. Protect it as `fs.delete` does.
14. **S-14 Rename/write check-then-act windows** (Low, confirmed) — `to.exists()` then `renameTo` and parent `mkdirs` then write can race. `renameTo` replaces an existing empty directory silently. Acceptable against the WebView threat model, noted for completeness.
15. **S-15 No directory fsync in AtomicWriter** (Low, confirmed) — file content is synced, the rename is not durable after power loss. The "crash-safe" claim holds for process crash only.
16. **S-16 Temp files visible and never cleaned** (Low, confirmed) — `.name.uuid.tmp` leftovers after a crash show in `fs.list` and nothing removes them.
17. **S-17 SAF open returns non-text as garbage with no E_BINARY** (Low, confirmed) — decode is lenient and there is no NUL check, unlike `fs.read`.
18. **S-18 Trash purge runs synchronously on every delete** (Low, confirmed) — a large trash makes `fs.delete` slow. Run it off the request path, rate limited.
19. **S-19 Debug build exposes the bridge to localhost:5173 and intent devUrl** (Low, confirmed) — debug only. Any local listener on that port, or any app sending `devUrl`, gets full bridge access in debug builds.
20. **S-20 Doc and CSP drift** (Low, confirmed) — `frame-ancestors` in a meta CSP is ignored by browsers; release is signed with the debug key (stated as phase 0); extraction has no total-size cap.

</details>

<details>
<summary>Details</summary>

## Trash purge destroys old files at the next delete (S-01)

`Trash.move` renames the target into the trash with `renameTo`, which preserves the file's modification time. `Trash.purge` (Trash.kt:56-68) decides age with `entry.lastModified() < cutoff`. `FsHandler.delete` (FsHandler.kt:138) calls `trash.purge()` before every move.

Scenario: a user deletes `notes.txt`, last edited 45 days ago. It lands in `.trash` with mtime 45 days old. The user deletes any other file a minute later. `purge` runs first, sees `notes.txt` older than the 30-day cutoff, and `deleteEntry` removes it permanently. Neither the doc ("never silent permanent delete", bridge-contract.md:122) nor the Trash KDoc ("Nothing is ever deleted permanently by the bridge") holds. `TrashTest.purge removes entries older than 30 days` sets mtimes by hand, so it never exercises the move-then-purge path. For directories the effect is worse: directory mtime changes with entry churn, so age is arbitrary.

Fix: the entry name already starts with the trash time (`$now-uuid-name`). Parse it in `purge`, or call `dest.setLastModified(now)` after a successful move (for directories this changes only the top entry, which is what `purge` looks at). A clock set backwards makes entries look young and a clock jumped forward purges everything; using the embedded timestamp with a sanity clamp (`age < 0` means keep) bounds that.

Confidence: CONFIRMED BY READING (`renameTo` preserves mtime on POSIX).

## Shared trash is visible, jailed, and deletable (S-02)

`.leocode-trash` lives at the root of `/sdcard` (AppGraph.kt:65). `fs.list` filters only the name `.trash` (FsHandler.kt:63), so listing `/sdcard` shows `.leocode-trash`. It is under the shared root, so the jail allows it. `delete` protects only the workspace roots and the shared root (FsHandler.kt:128-132).

Scenario: the user selects `.leocode-trash` and deletes it. `Trash.move` sees the target under shared storage, picks `sharedTrash` as the destination dir, which is the target itself, and builds `dest = <trash>/<now>-<uuid>-.leocode-trash`. `renameTo` into its own subtree fails, so the code takes the copy fallback. `copyRecursively` lists the source, which now contains the freshly created `dest`, and recurses into it, creating `dest/dest/...` until a path or name limit throws `IOException`; `deleteEntry(dest)` then runs. Result: disk churn, an error toast, a partially deleted trash. Items inside the trash, when deleted, are re-trashed inside the trash with the same naming.

Fix: add both trash directories to `protectedRoots`, refuse any target under a trash dir (or delete permanently from inside the trash, if "empty trash" is intended), and filter `.leocode-trash` in `list`. Also guard `Trash.move` against `dest` lying under `target`.

Confidence: CONFIRMED BY READING.

## Symlinks: delete and rename act on the target (S-05)

`resolve()` returns `canonicalFile`, so for a symlink `notes -> real/notes.txt`, `fs.delete("notes")` moves `real/notes.txt` into the trash and leaves `notes` dangling. `fs.rename("notes", "n2")` renames the target the same way. `Trash.deleteEntry` and `copyRecursively` were written with link-aware handling, but the handler never hands them a link. A link inside the workspace that points outside the jail (for example `ln -s /system sys` made in the terminal) cannot be deleted or renamed through the UI at all, because canonicalisation puts the path outside the roots and the call fails with `E_PATH_OUTSIDE_ROOT`. `fs.list` on a dir containing such a link reports the link as a file or dir by following it, and `rel(file)` for listed children uses non-canonical `normalize()`, so listing is inconsistent with resolve.

Fix: for delete and rename, resolve the canonical parent, append the unresolved final name, and verify the parent is jailed.

Confidence: CONFIRMED BY READING. The `deleteRecursively` symlink concern does not apply to the primary path (a single rename moves the link itself); in the copy fallback `copyRecursively` and `deleteEntry` check `isSymbolicLink` on the top entry and on each child during copy. Whether Kotlin's `deleteRecursively` follows links nested inside a directory was not verified (SUSPECTED, low; a unit test with a nested link to an outside file would confirm).

## FIFO and special files on read (S-03)

`read` checks `exists`, `isDirectory`, `length() > MAX_READ`, then `readBytes()` (FsHandler.kt:77-90). A FIFO reports length 0 and `readBytes` blocks until a writer appears. The workspace is the terminal cwd, so `mkfifo f` is one command away. The blocked thread is a bridge worker and the request never replies; client timeouts (Task 11) will fire, but the host thread leaks. A growing file (log being appended) can also exceed 2 MB between the length check and `readBytes`, and the returned string is then larger than the documented cap.

Fix: reject anything that is not a regular file, and read at most `MAX_READ + 1` bytes through a bounded stream.

Confidence: CONFIRMED BY READING.

## rel() and the /data/data alias (S-04)

`rel()` (FsHandler.kt:178) compares `file.normalize()` with `workspace.defaultWorkspace.normalize()`. `file` comes from `jail.resolve`, which is canonical. `defaultWorkspace` is built from `app.filesDir`, which on a device is `/data/user/0/dev.leocode/files`. On Android `/data/user/0` is a symlink to `/data/data`, so the canonical path starts with `/data/data/...` and the prefix test fails. In that case every reply carries absolute paths instead of relative ones. JVM tests use a temp dir with no symlink, so they cannot catch it. PROGRESS says list, rename and delete were verified on D1, which suggests the UI tolerates or does not hit this; the check is `fs.list(".")` on D1 and D2 and see whether `path` is `hello.sh` or `/data/data/...`.

Confidence: SUSPECTED. Fix is to canonicalise the root inside `rel()` (once, cached).

## Trash entry names and collisions (S-06)

Entry name is `"$now-${uuid}-${target.name}"`: 13 + 1 + 36 + 1 = 51 characters before the original name. Linux `NAME_MAX` is 255 bytes, so any file whose name is over about 204 bytes (fewer for non-ASCII, since the limit is bytes) fails `renameTo`, then fails in the copy fallback, and surfaces as `E_IO "delete failed"`. Collisions between entries are not a concern (UUID). Fix: truncate the embedded name to about 100 bytes.

Confidence: CONFIRMED BY READING.

## AtomicWriter: what survives and what does not (S-07, S-15, S-16)

The content path is correct. Three things are lost. First, the new inode is created with default mode, so overwriting an executable script drops `+x` (and any restrictive mode). `chmod +x run.sh` in the terminal, then editing and saving in the IDE, leaves `run.sh` non-executable; this will hit users running scripts, and the runtime depends on execve on targetSdk 28. Fix: read `Files.getPosixFilePermissions` of the existing target and apply to the temp file before the move. Hardlinks and ownership are also not preserved, which is fine.

Second, there is no fsync of the parent directory after the rename, so the claim "crash-safe" in the class KDoc holds for process death only. On power loss the rename may not be durable, though the old-or-new guarantee generally still holds on ext4/f2fs. Third, `.name.uuid.tmp` files from a killed process stay in the directory forever and are shown by `fs.list`; nothing sweeps them. Writing a name close to 255 bytes also fails because the temp name adds about 42 bytes.

The non-atomic fallback on `AtomicMoveNotSupportedException` cannot hit EXDEV, since the temp file is in the same directory, so cross-filesystem rename is not a real risk here. Writing to a directory path fails inside `Files.move` with an IOException and the temp is removed; write to a symlink writes the canonical target and replaces it, which is acceptable.

Confidence: CONFIRMED BY READING for all three.

## Text decoding and size limits (S-08, S-09, S-17)

`String(bytes, UTF_8)` replaces malformed sequences with U+FFFD. A Latin-1 source file opens with replacement characters and saving writes the replacement bytes back, corrupting the file with no warning. BOM is kept as `\uFEFF` and round-trips, which is correct. NUL detection scans the whole file, so `E_BINARY` has no first-N-bytes gap, but a binary without NUL (some compressed data) is returned as garbage text.

Limits: `fs.write` accepts 4 MB while `fs.read` rejects over 2 MB, so the app can create files it then refuses to open. The contract (bridge-contract.md:35) promises `maxBytes` chunking with `nextOffset`; `ReadRequest` has no such fields and no code implements chunking (grep for `nextOffset` in `android/app/src/main` finds nothing). SAF open uses the same lenient decoder with no NUL check.

Confidence: CONFIRMED BY READING.

## SAF open and save failure paths (S-10, S-11)

In `openLauncher`, the `leocode-saf-read` thread calls `queryUriFileName` (guarded) and `readUriContent` (not guarded). A `SecurityException`, `FileNotFoundException`, or `IOException` (provider revoked, cloud file offline) escapes a bare `thread {}`, goes to the default uncaught handler and kills the process; the bridge callback is never invoked, so the request would also never reply. `readUriContent` itself is bounded (reads at most `maxBytes + 1`), so heap exhaustion is not a concern, and a cut multi-byte sequence only matters in the over-limit case that is rejected anyway.

In `saveLauncher`, the `openOutputStream` write is inside `runCatching` and the result is ignored, then `request.callback(uri?.toString())` replies with the URI. A full disk or provider error reports success while the document is empty or truncated. Fix: capture the failure and reply `E_IO`.

Confidence: CONFIRMED BY READING. `saf.save` only creates new documents (`CreateDocument`), so there is no overwrite-in-place path and no persisted URI permission; reopening the same URI later is not supported, which is consistent with "copy-in/copy-out".

## Rename edge cases (S-12, S-13, S-14)

On sdcardfs/FUSE shared storage, name lookup is case-insensitive, so `to.exists()` is true when renaming `a.txt` to `A.txt` and the call fails with `E_EXISTS`. The common "fix capitalisation" operation is therefore impossible there. `workspaces/default` can be renamed because only `delete` protects it; after that `defaultWorkspace` does not exist, `fs.list(".")` returns `E_NOT_FOUND`, and `ProcHandler`/`TermHandler` default cwd fails until the app restarts and `ensure()` recreates it. Rename into itself (`a` to `a/b`) fails in `renameTo` and surfaces as `E_IO "rename failed"`, which is correct but unhelpful. Rename across the workspace and `/sdcard` roots passes the jail on both ends and then `renameTo` fails with EXDEV, returning the same generic `E_IO`; no copy fallback exists, unlike delete. `renameTo` also silently replaces an existing empty directory, and the exists-then-rename check is racy.

Confidence: CONFIRMED BY READING for rename of default and cross-root. LIKELY for the case-insensitive behaviour (depends on the device's storage layer; check on D2).

## Debug-only surface (S-19) and CSP/manifest notes (S-20)

`HarnessActivity` is declared only in `src/debug/AndroidManifest.xml`, so it is absent from release merges, and the main manifest exports only `MainActivity`; `RecoveryActivity` and `SessionService` are not exported. `devUrl`/`devMode`/`forceCrash` extras are guarded by `BuildConfig.DEBUG`. In debug, `MainActivity` is exported and `allowedOrigins` includes `http://localhost:5173`, which is also an allowed WebMessageListener origin. Any app on the device that binds that port when no dev server runs, or sends a `devUrl` intent, gets the whole bridge (fs and terminal included). Debug only, so Low.

WebView settings are tight (`allowFileAccess=false`, `allowContentAccess=false`, mixed content blocked, listener restricted to the asset origin). `allowBackup=false`, cleartext off in release. `frame-ancestors` has no effect in a meta CSP. Release uses the debug signing config (marked phase 0 in the build file). `RuntimeInstaller` extraction canonicalises each destination and rejects absolute, `..` and escaping symlink entries, but has no total-size cap on extracted bytes.

Console messages are logged with `Log.d` including source and message text (`LeoCodeWeb`); anything the UI logs, including paths, reaches logcat on debug and release alike.

## Unreachable-path audit

`fs.*` all call `resolve()`. `proc.run` and `term.open` resolve cwd through `jail.resolve` with the default workspace as base and then require a directory. Child env is built from `ChildEnv.build` allowlist. The terminal process itself is unjailed by design (it is a shell), so the jail protects the WebView from the filesystem, not the filesystem from the user. `RuntimeHandler` takes no path from the WebView.

## Runtime revocation

`storageGranted` is evaluated per call, and Android kills an app process on runtime permission revoke, so the open-tab case ends in a restart. After the restart, tabs holding `/sdcard/...` paths get `E_PATH_OUTSIDE_ROOT` on save. `storageGranted` checks only `READ_EXTERNAL_STORAGE` while writes need `WRITE_EXTERNAL_STORAGE` as well; both are requested together, but a user can grant one in settings on some OEM builds, and a write then fails as a generic `E_IO`.

</details>

## Claims not supported by the code

Trash KDoc and bridge-contract.md:122 claim the bridge never permanently deletes; S-01 contradicts that. bridge-contract.md:35 describes `maxBytes` and `nextOffset` chunked reads and "files above 2 MB require chunking"; neither exists in `FsHandler` or `ReadRequest`. `AtomicWriter` KDoc says "crash-safe" with no directory fsync. PROGRESS Task 4 states workspace and `/sdcard` reads and writes work on D1 and D2; those reports do not cover delete of old files, symlinks or FIFOs. PROGRESS Task 6 notes the device re-run is pending, so SAF behaviour on device is unverified.

## Behaviours with no unit test

Move-then-purge on one trash (the S-01 path); delete of the shared trash dir; delete or rename of a symlink; read of FIFO and other non-regular files; invalid UTF-8 and BOM round-trips; read/write limits at exactly the boundary and the 2 MB vs 4 MB asymmetry; write permission preservation; rename of the default workspace, rename across roots, rename into itself, case-only rename; trash entry name over 255 bytes; `rel()` when the workspace sits behind a symlink; `proc.run` and `term.open` cwd outside the jail (check `ProcHandler`/`TermHandler` tests); `SafHandler` async error paths and the `MainActivity` SAF launchers (no instrumentation tests at all).

## Checked and found correct

Separator-aware prefix check (`dev.leocodeX` rejected); canonical comparison with `..`, trailing slash, `.` and empty path (empty maps to `.`); NUL rejected before `File`; root itself allowed; fail-closed on canonicalisation errors; `/sdcard` alias paths (including `/storage/self/primary`) are expected to resolve to the same canonical root; shared root gated on a live permission check; delete protects workspaces root, default workspace and shared root; trash and shared trash selection by canonical containment; copy fallback removes partial copy and keeps the original on failure; atomic write uses a unique temp per writer in the target's directory and always cleans it on failure; no delete-before-rename; harness only in the debug manifest; debug extras gated on `BuildConfig.DEBUG`; only `MainActivity` exported in release; `allowBackup=false`; no FileProvider declared; CSP has no remote hosts, `object-src 'none'`, `base-uri 'none'`; extraction rejects absolute paths, `..`, escaping and absolute symlinks, and device or FIFO entries.

<details>
<summary>File map</summary>

Files reviewed (full diff: `git diff 542e14e..HEAD -- android/app/src`):

- `core/PathJail.kt`: canonical roots, live permission gate, resolver.
- `core/AtomicWriter.kt`: temp, fsync, atomic rename; no mode copy, no dir fsync.
- `core/Trash.kt`: rename or copy fallback, mtime-based purge (S-01, S-02, S-06).
- `core/Workspace.kt`, `core/ChildEnv.kt`: layout and env allowlist.
- `bridge/FsHandler.kt`: fs.* methods, `rel()`, protected roots (S-02 to S-05, S-08, S-09, S-12, S-13).
- `bridge/SafHandler.kt`, `bridge/SafPort.kt`: async SAF and storage methods, 4 MB cap.
- `MainActivity.kt`: SAF launchers, permission queue, WebView settings, dev URL handling (S-10, S-11, S-19).
- `AndroidManifest.xml` (main and debug), `build.gradle.kts`, `web/index.html` with `web/src/csp.ts`.
- `core/RuntimeInstaller.kt`: extraction paths only.

</details>
