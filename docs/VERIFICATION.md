# Catalyst Foundry verification

> Historical design-pass results. The current guided workflow and real slicing verification are recorded in [GUIDED-VERIFICATION.md](GUIDED-VERIFICATION.md).

Final design-pass verification in the supplied cloud environment on **2026-10-17**. No private account was connected, no credential created, no repository pushed, no application published and no printer operated.

## Exact commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | **Passed**, exit 0 (`tsc -b`) |
| `npm test` | **176 passed**, **14 test files**, exit 0; **6.18 s** |
| `npm run build` | **Passed**, exit 0; Vite build **3.98 s** |
| `npm run test:e2e` | **6 passed**, no skipped/flaky/unexpected cases, exit 0; **163.565 s** |
| `npx tsx scripts/smoke-production.ts` | **Passed**, exit 0; actual production build/API, WebGL2, inspectors/source dialog, 390 px layout and zero page errors |

The browser command expects `npm run dev` already running in another terminal. Recording also requires the public Playwright video helper, installed once with `npx playwright install ffmpeg` (run during this pass); the existing system Chromium is reused. The complete command sequence is:

```bash
cd /workspace/catalyst-foundry
npm run typecheck
npm test
npm run build
npm run dev
# In a second terminal:
npm run test:e2e
```

Node **24.19.0**, npm **11.9.0**, system `/usr/bin/chromium`, headless SwiftShader WebGL2. Dependency versions/integrities are pinned in `package-lock.json`. `CHROMIUM_PATH` and `E2E_BASE_URL` can override the test browser/path. Tests ran with one Chromium worker, 90-second test timeout, 15-second action timeout and 12-second assertion timeout; assertions/timeouts were not weakened to obtain passing results.

Build advisory: the Three.js-containing JavaScript bundle is **957.27 kB / 266.53 kB gzip**, above Vite's 500 kB advisory threshold. This is a performance optimization opportunity, not a failed build. CSS is **51.79 kB / 11.48 kB gzip**.

## Automated test coverage

| File | Tests | Coverage |
| --- | ---: | --- |
| `tests/domain.test.ts` | 30 | Exact manufacturing manifests, quantities, explicit units, stale results, approval, state transitions, deterministic package contents/hashes, duplicates, save/reopen |
| `tests/audit.test.ts` | 16 | Revoked mapping/review/slicer/provenance, corrupted original bytes and same-bounds vertex changes, persisted physical claims and current-manifest operator history |
| `tests/approval-pass.test.ts` | 22 | Async mutation during import/review/approval/export, transactional release, changed mappings/reviewer, idempotent revocation/review/export, shared byte/unit changes, malformed review-date recovery, duplicate source paths and valid repeated/nested quantities |
| `tests/onshape.test.ts` | 16 | Nested/repeated occurrences, config/spares, purchased/suppressed/unavailable linked parts, versions, cache/cancel/failures and API-shaped HTTP/OAuth translation boundary |
| `tests/geometry.test.ts` | 10 | Actual ASCII/binary STL, explicit mm/in normalization and conversion errors, preserved originals/hashes, invalid/oversized geometry and warnings |
| `tests/toolpaths.test.ts` | 10 | Actual G-code layer/feature/units/modes/G92/Z-hop interpretation, invalid and unsupported commands and limits |
| `tests/slicer.test.ts` | 13 | Separate worker progress/logs/cancellation/duplicates/interruption, pinned executable/profile hashes, documented CLI arguments with injected runner, real local Node process termination/timeouts/errors |
| `tests/viewer.test.ts` | 7 | Real mesh rotation/seating, canonical conventions, invalid rotation and installed metre/mm transforms |
| `tests/camera.test.ts` | 15 | Independent projection checks for every bounds corner, iso/front/top views, wide/narrow aspects, insets, resize/pan/orbit/zoom preservation, empty/point and extreme geometry |
| `tests/preparation-status.test.ts` | 2 | Out-of-volume/invalid-process preparation requires review, explicit correction restores readiness, and incorrect saved readiness claims are downgraded on reopen |
| `tests/preparation.test.ts` | 25 | Conservative all-copy/spare orientation/placement, quantity reconciliation, all category profiles and preserved overrides, navigable preflight, units, unavailable sources, overlap, invalid settings and disclosed nozzle heuristic |
| `tests/project-transitions.test.ts` | 3 | Shared reclassification invalidates every affected job; unrelated batch and navigation/category advice preserve approval |
| `tests/project-recovery.test.ts` | 4 | Newer draft versus saved state, newer disk save priority, disconnected recovery and corrupt draft isolation |
| `tests/server.test.ts` | 3 | Actual local HTTP/file save/reopen with atomic rename, unavailable capabilities, bad imports, prior save retention, cross-origin mutation rejection and bad disk recovery |

The first inspection also ran existing approval/viewer/domain/shared-transition regressions: **56/56 passed**. Code review and new tests then addressed the previously uncovered projected-fit and asynchronous approval/export defects. The previous vertical-slice baseline contained 112 automated tests; this pass adds 64 regressions.

## Complete browser workflow, not a visual mockup

| Browser case | Result / duration |
| --- | --- |
| Fixture selection → preparation → actual G-code → exact approval → two checksummed exports → assignment → real disk reopen → portable reopen → stale/newer-draft/outage recovery | Passed · **53.997 s** |
| Invalid link/configuration/cancelled transfer/STL units/unsupported G-code/failed project import recovery | Passed · **8.604 s** |
| Mobile source picker, disconnected save, recovery export and overflow checks | Passed · **2.922 s** |
| Revoked mapping, new mapping, changed material/orientation, duplicate approval events and save/reopen invalidation | Passed · **30.521 s** |
| Real WebGL pixel checks, fit/orbit/pan/zoom, exact camera preservation after process edits, desktop/tablet/mobile resizing and queue search/filter/empty states | Passed · **19.340 s** |
| Quantity reconciliation with spares, linked preflight control focus, explicit placement/orientation suggestions and assumptions, manual load context, installed orientation, editable categories/profiles/overrides/presets, isolated new revision, and blocking-overlap/readiness correction | Passed · **44.437 s** |

Total runner duration includes overhead. Machine-readable results: [browser-test-results.json](design-pass/browser-test-results.json). Local HTML report: `playwright-report/index.html`.

The main persistence path forwards browser `/api/project` calls to the actual Express app on an ephemeral local port with an isolated disk directory, exercising real validation/write/rename/reopen. It clears browser draft storage to prove disk recovery. Auxiliary failure cases explicitly mock unavailable persistence to exercise recovery; they do not claim live remote services.

The camera test reads actual WebGL pixels, requires visible selected geometry away from clipping edges, and compares rendered bytes before/after unrelated process changes. It does not merely assert that a canvas element exists.

The additional production smoke uses the built application served by Express with an isolated disposable data directory and **no API mocks**. It verifies HTTP 200, four actual fixture parts, WebGL2, both contextual inspectors, the disconnected source dialog, mobile overflow and honest capability responses. Reproduce after `npm run build`:

```bash
PORT=3002 CATALYST_DATA_DIR=/tmp/catalyst-design-production-smoke npm start
# In a second terminal:
npx tsx scripts/smoke-production.ts
```

Machine-readable production evidence: [production-smoke.json](design-pass/production-smoke.json). The temporary production listener was stopped afterward; the development preview remains available on port 5173.

## Evidence

[Watch the actual 52.52-second recorded workflow](design-pass/complete-workflow.webm) (VP8, 1512×1050).

- [After source selection](design-pass/after-source.png)
- [After preparation](design-pass/after-prepared.png)
- [Actual G-code layer inspection](design-pass/after-toolpath.png)
- [Exact manifest approval](design-pass/after-approved.png)
- [Package export](design-pass/after-export.png)
- [Reopened saved work](design-pass/after-reopened.png)
- [Actual exported demonstration ZIP](design-pass/demonstration-approved-package.zip)
- [Portable demonstration project](design-pass/demonstration-project.catalyst.json)

The ZIP's complete approval hash and **every exported file checksum** were independently checked in the browser test. It is explicitly **NON-MANUFACTURABLE**. The G-code is manually authored demonstration input and was not sliced from the selected geometry.

See [before/after screenshots and design explanation](DESIGN-PASS.md) for matching 1512×1000, 1024×800 and 390×844 renders and the revised queue.

## Connected, simulated and remaining limits

**No remaining reproduced blocker** was found in the bounded fixture/import/prepare/review/approve/export/reopen workflow. Remaining limitations and unqualified paths:

- Live Onshape is **unavailable**. Fixture selection/geometry transfer and API-shaped adapter tests are demonstrated; no authorised live account, translation, linked document or live revision query was run. See [authentication and live test setup](ONSHAPE.md).
- Actual Bambu Studio slicing is **unavailable**. No verified executable or complete physically tested printer/nozzle/plate/filament/process profiles are configured. CLI tests use injected runners; subprocess tests use local Node processes. See [profile qualification](SLICING.md).
- The real G-code viewer supports a conservative linear subset. Arcs, homing, proprietary/nonplanar programs and other unsupported motion block approval rather than being approximated. Many complete Bambu machine-start programs need further qualification.
- External G-code-to-geometry/settings mapping is an **operator attestation**, not proof that an external slicer used the declared inputs. Review names are local/self-reported, not authenticated digital signatures.
- Orientation/placement use **conservative rotated source bounding boxes** and an explicit copy grid. They do not perform mesh contact/collision analysis, support generation, FEA, load inference, weak-point analysis or physical validation. Brims, machine exclusion zones, process data and actual toolpaths require review.
- All fixture or untested-profile packages remain demonstration-only. Assignment/export perform **no dispatch** and imply no machine acceptance or printing. Physical preflight checks are operator attestations, not software observations.
- A manufacturing job currently uses one material/process profile for its whole batch; per-object slicing overrides are not implemented. Split jobs when parts need different processes. The fixture revision UI compares the first active fixture configuration; mixed-configuration batches require separate revision review.
- Laser integration, numerical Onshape simulation access, additional geometry formats, native slicer-project editing, authenticated team identities and multi-user conflict resolution remain deferred.
- The local service stores one active workspace project. Portable projects preserve separate copies; this is not a multi-user manufacturing server. Browser draft recovery is subject to browser storage limits.
- Bundle splitting remains an optimization opportunity. Cloud software WebGL with video capture is slower than hardware rendering; browser timeouts were retained rather than enlarged.
