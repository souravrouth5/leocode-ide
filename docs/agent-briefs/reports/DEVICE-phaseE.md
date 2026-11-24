# Phase E Device Pass Report

Date: 2026-11-24  
Branch: `phase-e-root` (`cf31792 root(web): B4/B5 review fixes F1-F3 + synced bundle`)  
Build Artifact: [`dist/release/leocode-1010.apk`](file:///home/sourav/Desktop/Apps/leocode/dist/release/leocode-1010.apk) (18,937,629 bytes, SHA-256: `87dcf299bf45a4894f38729e2890950402bd9568c15af6bdd7d762d13b52f183`)

### Tested Devices
- **D2 (Rooted):** POCO F1 (`lineage_beryllium`, Android 15 / LineageOS 22, API 35, Magisk 31.1). Serial: `e76846f` / Wi-Fi ADB. LeoCode UID: `10562`.
- **D1 (Unrooted):** Redmi Note 7S (`lavender`, Android 9 / MIUI, API 28). Serial: `11f98015` (USB).

---

## 1. Test Matrix Summary

| Row | Name | D2 (Rooted) | D1 (Unrooted) | Evidence / Screenshot | Notes |
|---|---|:---:|:---:|---|---|
| **E-00** | Root pidfile works | **PASS** | N/A | [`E-00.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-00.png) | Pidfile `files/run/root/245aa690-*.pid` created with `12657 1836051`; `ps` confirmed `PID 12657 USER root NAME sh`. No "Root pid unknown" in logcat. |
| **E-01** | No `su` prompt at startup | **PASS** | N/A | [`E-01-startup.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-01-startup.png) | Cold start with unlisted policy. Logcat: `root.status => available=true, granted=false, enabled=true`. Zero `su` invocations during startup. |
| **E-13** | Status/Diagnostics never prompt | **PASS** | N/A | [`E-01-diagnostics.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-01-diagnostics.png) | Opened Settings › Advanced and Settings › About › Diagnostics 3× each. Zero `su` calls in logcat, no superuser prompts. |
| **E-02** | D1: "Root not available" | N/A | **PASS** | [`E-02.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-02.png) | Settings › Advanced shows Root Mode toggle disabled with subtitle: *"Root is not available on this device."* Zero `su` calls in logcat. |
| **E-03** | Enable → warning → grant → chip | **PASS** | N/A | [`E-03.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-03.png) | Warning Cancel leaves toggle OFF; Accept grants root. Logcat: `root.request result => granted=true`. |
| **E-04** | Grant denied → sheet + Try again | **PASS** | N/A | [`E-04.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-04.png) | Policy 1 (deny). Rejection displays `E_ROOT_DENIED` bottom sheet with **Try again** button; Root Mode toggle stays OFF. |
| **E-06** | Root shell is uid 0 | **PASS** | N/A | [`E-06.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-06.png) | Terminal command `id; echo $$` output `uid=0(root)` and PID `15385`, exactly matching pidfile `15385 2018997` and root `sh` in `ps`. |
| **E-07** | Run as root: output + exit code | **PASS** | N/A | [`E-07.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-07.png) | Script `test.sh` (`id -u; exit 3`) output `0`, status badge showed `FINISHED IN 113 MS (EXIT 3)`. |
| **E-09** | `# ROOT` only while alive | **PASS** | N/A | [`E-07.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-07.png), [`E-08.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-08.png) | `# ROOT` badge displayed in Run Sheet while running; disappears immediately when execution completes. |
| **E-08** | Stop root job leaves no process | **PASS** | N/A | [`E-08.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-08.png) | Stopped `sleep 600` job via Stop button; exited root shell via Exit Root Shell. Both times `$LEAK` was completely empty, and pidfiles were deleted. |
| **E-16** | Root kill reaches children | **PASS** | N/A | [`E-16.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-16.png) | Root script spawned `sleep 600 & sleep 601 & wait`. On Stop, both child processes (PIDs 17064 & 17065) terminated cleanly. `$LEAK` empty. |
| **E-17** | Early Stop doesn't leak | **PASS** | N/A | [`E-17.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-17.png) | Rapidly tapped Run and Stop (<0.5 s) 3 consecutive times. `$LEAK` was empty on every run, 0 pidfile leftovers. |
| **E-05** | Revoke → next root op refused | **PASS** | N/A | [`E-05.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-05.png) | Policy switched to deny. New root actions rejected with `E_ROOT_DENIED` sheet. Shell A stayed functional as `uid=0`. |
| **E-18** | Try again keeps open root shells | **PASS** | N/A | [`E-18.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-18.png) | Shell A running `sleep 900` remained active and connected through grant policy recovery. (See notes on leftover PGID). |
| **E-11** | Root orphan reaped on next root use | **PASS** | N/A | [`E-11.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-11.png) | Forced-stopped while running `sleep 600` (orphan PID 18934 survived). On relaunch, opening Root Shell reaped PID 18934 and wiped old pidfile. |
| **E-12** | Disable persists across relaunch | **PASS** | N/A | [`E-12.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-12.png) | Disabled Root Mode, force-stopped app, cold launched. Toggle remained OFF; logcat confirmed `enabled=false`. |
| **E-14** | Phantom-process option | **PASS** | N/A | [`E-14.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-14.png) | Confirmed with owner first. Applied phantom limit via Settings › About › Background survival. UI showed green `Applied (2147483647)`. ADB confirmed `device_config get activity_manager max_phantom_processes` = `2147483647`. |
| **E-15** | Pending prompt doesn't hang UI | **PASS** | N/A | [`E-15.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-15.png) | In Magisk 31.1, unlisted su requests are auto-denied by magiskd in 15 ms. App displayed `E_ROOT_DENIED` sheet; UI remained completely fluid. |
| **E-10** | `su` denied / normal features work | **PASS** | **PASS** | [`E-10-D2.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-10-D2.png), [`E-10-D1.png`](file:///home/sourav/Desktop/Apps/leocode/docs/device-reports/20261124-phaseE/E-10-D1.png) | Both devices ran `scripts/smoke.sh` cleanly (D2: 407 ms cold start; D1: 3833 ms cold start). Normal non-root features operate unhindered without root prompts. |

---

## 2. Findings, Observations & Edge Cases

### 1. Magisk 31.1 Whitelist Architecture Change
On D2 running Magisk 31.1 (`31100`), Magisk has transitioned away from the legacy popup toast request prompt for apps not in its policy database. Instead:
- Unwhitelisted apps requesting `su` are rejected silently and immediately (`su: request rejected (10562)` within ~15 ms).
- Apps must be added to the Superuser whitelist via Magisk's **Superuser › `+` (Grant Superuser)** screen or populated via `magisk --sqlite "INSERT INTO policies..."`.
- LeoCode handles both the immediate rejection and configured denial identically via the `E_ROOT_DENIED` sheet with the **Try again** action, preventing any UI freezing.

### 2. Row E-18 Foreground Interactive Job PGID
During row E-18, `sleep 900` was run in the interactive foreground inside the root shell:
- `sleep 900` set its own process group (`PGID: 18407`), distinct from the root shell's PID.
- When **Exit Root Shell** was tapped, LeoCode invoked `kill -15 -$pid` and `kill -9 -$pid` on the shell PID, cleanly removing the root shell `sh` and its pidfile. Because `sleep 900` belonged to PGID 18407, it was reparented to init (`PPID 1`).
- As anticipated by the test plan specification (*"record the PGID column of the leftovers"*), leftover process `PID 18407 PGID 18407` was recorded and subsequently cleaned up.

### 3. Cleanup & Final State Verification
- D2 Magisk policy restored to `policy=2` (allow).
- `stayon` set to `false` on both D2 and D1.
- No repository source files were modified, and neither `test-matrix.md` nor `PROGRESS.md` were edited.
