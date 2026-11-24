# Phase E device pass review

**Verdict: most of Phase E is proven on the phone. Two rows fail or weren't really run, and one
needs a setting check.** Don't mark Tasks 17–18 done yet. One small brief (B6) plus a short re-run
should close it.

Reviewed: `reports/DEVICE-phaseE.md`, the raw logs `20261124-phaseE-D2-e76846f.txt` and
`20261124-phaseE-D1-11f98015.txt`, the screenshots `E-05.png` and `E-18.png`, and the code in
`AppDialogs.tsx` / `TerminalPane.tsx` (root retry paths).

## Proven on device (accepted)

| Row | What it proves |
|---|---|
| E-00 | Root pidfile written as `-rw-r--r-- root`, `"<pid> <start>"`, readable by the app; the pid is a root `sh` group leader |
| E-01 / E-13 | Zero `su` calls at startup and from Settings/Diagnostics (logcat) |
| E-02 (D1) | Toggle disabled, "Root is not available on this device", no `su` calls |
| E-03 / E-04 | Warning Cancel is a no-op; grant enables; deny gives the `E_ROOT_DENIED` sheet + Try again |
| E-06 | Root shell is `uid=0`; `$$` matches the pidfile (15385) |
| E-07 / E-09 | Run as root prints `0`, `EXIT 3`; `# ROOT` only while running |
| E-08 part 1, E-16, E-17 | Stopping a root **job** kills it and its children (`sleep 600 & sleep 601`), even when stopped within 0.5 s |
| E-11 | A root orphan that survived force-stop is reaped on the next root use, with no prompt at launch |
| E-12 | Disable persists across a cold start |
| E-14 | Phantom option applied, `2147483647` read back via adb |
| E-10 | Normal features with root denied (D2) and on unrooted D1; R8 rc10 cold starts 407 ms / 3833 ms |

## Problems

### P1 (High): E-18 is a FAIL, not a PASS. A foreground job leaks when a root shell is closed

The log says: `sleep 900` running in the root shell had `PGID 18407` (its own group, because the
interactive `sh -i` uses job control). Exit Root Shell killed the shell's group only, `sleep 900`
was reparented to init **as root**, and it was "manually reaped". That is exactly the leak R-04 is
meant to prevent. Typing any long command in a root terminal and closing the tab leaves it running
as root.

**E-08 part 2 contradicts this** (same scenario, "`$LEAK` empty"), and its log has no raw `ps`
output. Treat E-08 part 2 as unproven.

**Fix (B6):** a root **terminal** must be killed by **session**, not by group. The root `sh` is a
session leader (needs a device check, see B6 step 0). Kill every process whose session id equals
the recorded root pid: TERM first, then KILL after the grace period. Also use this in the root
orphan reaper for `root-term` records. Root **jobs** keep the group kill: E-16 proves it works.

### P2 (High): E-05 wasn't really run, so `root.lost` is still unproven on device

The `E-05.png` screenshot shows a **non-root** terminal (no `# ROOT`, no Root Shell button) with
the `E_ROOT_DENIED` sheet labelled **"During: unhandled promise rejection"**. That is the
`root.request` path (the toggle / Try again), not "root shell B refused → `root.lost` banner". The
log also has no `root.lost` / banner line and no proof that shell A kept uid 0. So the whole
refusal → `root.lost` → banner chain (R-03, B3 F1, B4 banners) has **no device evidence yet**.
Re-run it as written (§ Re-run below).

### P3 (Medium): a failed "Try again" escapes as an unhandled rejection

`AppDialogs.tsx` passes `retry: () => void stores.root.getState().requestRoot()` to the error
sheet. When that retry is refused, the rejection isn't caught, the global handler shows it, and
the sheet says "During: unhandled promise rejection" (E-04/E-05 screenshot). `TerminalPane.tsx`'s
banner **Try again** has `catch { /* error reporting handled */ }`, which actually **swallows** the
error, so a refused retry there shows nothing. **Fix (B6):** both retries go through one helper
that catches the error and reports it with `context: "Request root"` and the same retry.

### P4 (Low, owner check): E-15 couldn't exercise a pending prompt

Magisk denied the unlisted app within 15 ms. That usually means **Magisk › Settings › Superuser ›
Automatic response** is set to **Deny**; the default is **Prompt**. If it's Deny, switch it to
Prompt and re-run E-15 and E-03 (with a real Grant tap). If it's already Prompt and still denies
instantly, record E-15 as "not reachable on Magisk 31.1"; the unit test covers the timeout (R-01).

### Evidence quality

The raw logs are mostly prose ("`$LEAK` output is empty") without the commands and their real
output. For the re-run, every check must show the exact command and its output.

## Re-run after B6 (D2, rc11)

| Row | Steps | PASS when |
|---|---|---|
| E-08b | Root Shell: run `sleep 600` in the foreground → Exit Root Shell | `su -c "ps -A -o PID,PPID,PGID,SID,USER,NAME"` filtered to `sleep` is empty (paste it); pidfile gone |
| E-18 | Root shell A runs `sleep 900`; policy deny → allow; Try again | Shell A and `sleep 900` survive the grant (paste the `ps`); then Exit Root Shell → `sleep 900` gone (paste the `ps`) |
| E-19 | Root shell: `sleep 700 &` then `sleep 701` in the foreground → force-stop app → relaunch → open Root Shell | Both sleeps gone within ~3 s (the reaper's session kill) |
| E-05 | Policy allow, root mode on; open root shell A (`id`). Policy deny. Tap Root Shell again (shell B). Then Run as root `id`. | Shell B: the "Root access was refused" banner (screenshot); run sheet: the same banner; shell A still prints `uid=0` for `id` (screenshot) |
| E-04b | Policy deny; in the B-banner or error sheet tap **Try again** | The sheet shows the context "Request root", **not** "unhandled promise rejection" |
| E-15 | Only if Automatic response was switched to Prompt (P4) | UI stays responsive; the outcome and time are recorded |
