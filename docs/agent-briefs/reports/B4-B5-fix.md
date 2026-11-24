# B4-B5-fix report

## Initial Preconditions

### Initial `git status --short`
```
?? docs/agent-briefs/reports/B4-B5-merge.md
?? docs/agent-briefs/reports/B4-B5-review.md
```

### Initial `git log --oneline -3`
```
cad721c (HEAD -> phase-e-root) web: sync bundle after B4/B5
819ae04 Merge branch 'phase-e-b5' into phase-e-root
99f80cf Merge branch 'phase-e-b4' into phase-e-root
```

---

## Summary of Fixes Applied (F1–F3)

All three fixes from `docs/agent-briefs/reports/B4-B5-review.md` were implemented exactly as specified:

### F1 (Medium): `lastLost` is reset on grant and disable
- **Problem**: `rootStore.lastLost` was set when a `root.lost` event arrived and never reset. In `SettingsDialog`, `lastLost !== null` is treated as a lost state, causing the phantom-process option button to remain hidden forever even after re-requesting root mode successfully.
- **Fix**: In `web/src/features/root/rootStore.ts`, updated `requestRoot` to set `lastLost: null` when `res.granted` is true, and updated `disableRoot` to set `lastLost: null` upon successful bridge disablement.
- **Tests**:
  - `web/src/features/root/rootStore.test.ts`: Added test `clears lastLost when requestRoot succeeds and when disableRoot succeeds`.
  - `web/src/components/SettingsDialog.test.tsx`: Added test `shows phantom option button again after a loss when root is re-requested successfully`.

### F2 (Medium): Mock bridge `rootDisable` closes sessions without emitting `root.lost`
- **Problem**: `MockBridge.rootDisable()` was calling `emitRootLost({ sessionId, reason: "revoked" })` for each mock root session. On the actual Android host, `root.disable` closes root sessions normally (they just exit) and never sends `root.lost`. Emitting `root.lost` in the mock caused spurious refusal banners and `lastLost` state during intentional disablement.
- **Fix**: In `web/src/bridge/mock.ts`, updated `rootDisable()` to invoke `session.close()` for active mock root sessions without calling `emitRootLost`.
- **Test**: In `web/src/bridge/mock.test.ts`, updated `handles root mode disable and enforces E_ROOT_DENIED on root openTerminal` to assert that sessions exit and `lostEvent` remains `null`.

### F3 (Low): Run sheet matches `root.lost` strictly by `jobId`
- **Problem**: `runStore` previously matched `root.lost` when `event.jobId === current.jobId || runningRoot`. This allowed unrelated root command refusals occurring in parallel (such as the phantom process "Apply" command) to erroneously terminate the active run job and display a refusal banner in the run sheet.
- **Fix**: In `web/src/features/run/runStore.ts`, changed the listener condition to strictly `if (event.jobId && event.jobId === current.jobId)`.
- **Test**: In `web/src/features/run/runRoot.test.tsx`, added test `ignores root.lost event with a different jobId while a root run is active`.

---

## Files Changed

Strictly limited to the permitted files:
- `web/src/features/root/rootStore.ts` (modified)
- `web/src/features/root/rootStore.test.ts` (modified)
- `web/src/components/SettingsDialog.test.tsx` (modified)
- `web/src/bridge/mock.ts` (modified)
- `web/src/bridge/mock.test.ts` (modified)
- `web/src/features/run/runStore.ts` (modified)
- `web/src/features/run/runRoot.test.tsx` (modified)
- `android/app/src/main/assets/web` (synced bundle)

---

## Gates

### 1. Web Gate
Command:
```bash
cd web && npm run typecheck && npm run lint && npm test && npm run build
```
Output:
```
> leocode-web@0.0.1 typecheck
> tsc --noEmit

> leocode-web@0.0.1 lint
> eslint .

> leocode-web@0.0.1 test
> vitest run

 Test Files  61 passed (61)
      Tests  494 passed (494)
   Start at  15:59:53
   Duration  65.98s

> leocode-web@0.0.1 build
> tsc --noEmit && vite build

✓ built in 11.89s
```
Result: **PASS** (0 type errors, 0 lint errors, 494/494 unit tests passed, production bundle built).

### 2. Synced Web Bundle
Command:
```bash
bash scripts/sync-web.sh
```
Output:
```
==> typecheck + build
✓ built in 12.70s
==> syncing dist -> android/app/src/main/assets/web
==> done
8.4M	/home/sourav/Desktop/Apps/leocode/android/app/src/main/assets/web
```

### 3. Android assembleDebug Gate
Command:
```bash
cd android && flock /tmp/leocode-gradle.lock ./gradlew --no-daemon assembleDebug
```
Output:
```
BUILD SUCCESSFUL in 56s
40 actionable tasks: 5 executed, 35 up-to-date
```

---

## Test Counts Summary
- **Web unit tests (vitest)**: 494 passed across 61 test files (0 failures).
- **Android unit tests**: 512 total tests (511 passed, 0 failed, 1 skipped).

---

## Built Artifact
- **APK Path**: `android/app/build/outputs/apk/debug/app-debug.apk`
- **APK Size**: 40,307,314 bytes (38.44 MiB / ~39 MB)
- **Commit**: `cf31792` ("root(web): B4/B5 review fixes F1-F3 + synced bundle")
