# Guided Foundry verification

Verified in the supplied Linux cloud workspace on **2026-10-17 Pacific** (machine logs use 2026-10-18 UTC). No private accounts were connected, credentials created, printers operated, security settings changed, repositories pushed or application published. This report supersedes the earlier [design-pass report](VERIFICATION.md).

## Final automated and build results

| Exact command | Result |
| --- | --- |
| `npm run typecheck` | Passed, exit 0 |
| `npm test` | **262 passed**, **19 files**, exit 0, **11.31 s** |
| `npm run desktop:prepare` | Passed, exit 0; invokes `npm run build` (TypeScript + Vite), then bundles the desktop service |
| `npm run build` (inside desktop preparation) | Passed, exit 0; Vite **5.25 s**, **1682 modules** |
| `node scripts/windows/verify-bundle.mjs` | Passed, exit 0; real offline bundled service, disk save/new-service reopen, loopback/origin/host checks and shutdown |
| `npx tsx scripts/smoke-production.ts` | Passed, exit 0; actual built UI/API, explicit fixture intake, WebGL2, collapsed advanced controls, source setup, 390 px layout and zero page errors |
| `node scripts/smoke-service.mjs` | Passed, exit 0; actual standalone production entry, HTTP 200, SIGTERM exits 0 and closes listener |
| `node --check` on `electron/main.cjs`, `electron/runtime.cjs`, `scripts/windows/build-desktop.mjs`, `scripts/windows/verify-bundle.mjs`, `scripts/smoke-service.mjs` | All passed, exit 0 |

Node **24.19.0**, npm **11.9.0**, system Chromium with SwiftShader WebGL2, one Playwright worker. Dependency versions/integrities are pinned. The final unit suite includes the shutdown-during-capability-probe regression. No test assertions/timeouts were weakened to get a pass.

The UI bundle is **990.68 kB / 275.87 kB gzip** and CSS **60.82 kB / 13.29 kB gzip**. Vite's >500 kB advisory remains a performance optimization opportunity. The independent desktop server bundle is **2.2 MB**, produced in **201 ms**. Bundle preparation does not validate Windows installation.

Production browser evidence: [production-smoke.json](guided-workflow/production-smoke.json). The production listener used `HOST=127.0.0.1 PORT=3002 CATALYST_DATA_DIR=/tmp/catalyst-guided-prod-smoke npm start` with a disposable directory. No API was mocked. Reproduce with that listener running, then `npx tsx scripts/smoke-production.ts`.

A clean isolated copy of `package.json`/lockfile also passed `npm ci --ignore-scripts --no-audit --no-fund` with Git deliberately set to a nonexistent executable: **523 packages, 12 s**. This verifies registry-only dependency fetching, not lifecycle downloads or Windows. The scoped registry node-gyp override and its portability regression are explained in [WINDOWS.md](WINDOWS.md).

## Complete browser and failure-path results

The full suite passed **10/10**, with **zero skipped, unexpected or flaky cases**, exit 0, **258.126591 s**. Machine-readable original result: [browser-test-results.json](guided-workflow/browser-test-results.json).

| Browser case | Result / duration |
| --- | --- |
| Actual pinned Bambu CLI, explicit fixture geometry, native project, unsupported commands block approval/export | Passed · 30.188 s |
| Actual HTTP services with explicitly mocked Onshape upstream and synthetic CLI: selection → dimensions → geometry → profiles → preparation → review → exact approval → checksummed export → real disk reopen | Passed · 30.028 s |
| Expired access, wrong units, cancelled intake, failed slicing, disconnected status, cancellation and fresh retry | Passed · 14.719 s |
| Full fixture/manual-G-code workflow, duplicate hashed exports, assignment, real disk reopen, portable reopen and draft/outage recovery | Passed · 59.561 s |
| Invalid links/configuration, cancelled fixture transfer, inch STL, unsupported G-code and failed project import recovery | Passed · 11.827 s |
| Mobile disconnected save and recovery | Passed · 2.543 s |
| Changed/revoked mapping, material/orientation, duplicate approval and save/reopen invalidation | Passed · 34.679 s |
| Real WebGL pixel checks, fit/orbit/pan/zoom/camera preservation, desktop/tablet/mobile and queue search/filter | Passed · 21.435 s |
| Quantity/spare reconciliation, linked preflight focus, placement/orientation assumptions, context, presets/overrides and isolated revision | Passed · 37.818 s |
| Empty guided first launch, explicit fixture opt-in, setup/login state, mobile width and collapsed advanced controls | Passed · 8.807 s |

The configured-service case also changes inputs while profiles and preparation are awaiting responses. Stale responses cannot overwrite the changed nozzle or queue a stale job. Actual geometry, API validation, profile resolution, hashes, worker state and persistence run locally; only external CAD responses and the explicitly synthetic runner are simulated in that case.

After the full run, two focused UI corrections collapsed unsupported-command details and added explicit missing-approval recovery at Export. A separate final rerun passed **3/3**, with zero skipped, unexpected or flaky cases, exit 0, **98.070643 s**: actual CLI/native-review disclosure **23.911 s**; complete approval/export/reopen **58.276 s**; first launch/missing-approval recovery/disclosures **9.966 s**. Exact result: [final-ui-retest.json](guided-workflow/final-ui-retest.json). This verifies the final UI changes without unnecessarily repeating unrelated cases.

The server was already running through `npm run dev`. Exact full-suite command:

```bash
CATALYST_REAL_SLICE_CONFIG=/tmp/catalyst-bambu-runtime/config.json \
LD_LIBRARY_PATH=/tmp/catalyst-bambu-runtime/deps/usr/lib/x86_64-linux-gnu:/tmp/catalyst-bambu-runtime/squashfs-root/bin \
LC_ALL=C \
PLAYWRIGHT_JSON_OUTPUT_FILE=docs/guided-workflow/browser-test-results.json \
npm run test:e2e -- --reporter=list,json > /tmp/catalyst-guided-browser-verification.log 2>&1
```

Exact final UI rerun command uses the same runtime environment:

```bash
CATALYST_REAL_SLICE_CONFIG=/tmp/catalyst-bambu-runtime/config.json \
LD_LIBRARY_PATH=/tmp/catalyst-bambu-runtime/deps/usr/lib/x86_64-linux-gnu:/tmp/catalyst-bambu-runtime/squashfs-root/bin \
LC_ALL=C \
PLAYWRIGHT_JSON_OUTPUT_FILE=docs/guided-workflow/final-ui-retest.json \
npm run test:e2e -- --grep 'genuine pinned|complete fixture workflow|guided first launch' --reporter=list,json > /tmp/catalyst-guided-final-ui.log 2>&1
```

These `/tmp` paths are the explicitly prepared cloud binary/profile/runtime setup, not portable defaults. Without `CATALYST_REAL_SLICE_CONFIG`, the real CLI browser case reports an explicit skip; synthetic and fixture tests alone must not be reported as actual slicing. The reported full run above did set the variable and ran all ten cases.

Responsive evidence was captured with `npx tsx scripts/capture-guided-evidence.ts`: desktop 1512 px, tablet 1024 px, mobile 390 px, mobile inspector and preflight; zero page errors or document overflow. The fixture opt-in is explicit and API project loading is a labelled test double for these screenshots, leaving saved work untouched.

## Unit and API coverage

| Files / test counts | Coverage |
| --- | --- |
| `domain` 30, `audit` 16, `approval-pass` 22, `requirements-audit` 39 | Exact manifest/artifact hashes, every additional relevant input, shared invalidation, mappings, async races, transactional/duplicate release, physical-state provenance and actual three-copy 3MF vertex checks |
| `onshape` 16, `onshape-http` 18, `source-configuration` 8 | Nested/repeated/linked/suppressed instances, configurations/spares, immutable child/root provenance, real local HTTP transfer, inch/mm validation, permissions/login/rate-limit/timeout, cache/cancel and browser fetch receiver |
| `geometry` 10, `viewer` 7, `camera` 15 | ASCII/binary STL, originals/units/oversize/invalid data, manufacturing vs installed transforms, exact perspective bounds fitting, resize/pan/orbit/zoom preservation |
| `toolpaths` 12, `slicer` 15, `slicing-http` 9 | Actual linear G-code, units/modes/unsupported command blocking, real process termination, pinned full-profile resolution/mapping, portable paths, cancellation/retry/shutdown/restart and native-project integrity |
| `preparation` 25, `preparation-status` 2 | Explained heuristic candidates, all-copy fit/overlap, spares/reconciliation, retained overrides, navigable errors and saved readiness correction |
| `project-transitions` 3, `project-recovery` 4, `server` 3 | Shared source invalidation, unrelated batch preservation, newest valid draft, disconnected recovery and real atomic disk save/reopen |
| `desktop` 8 | Renderer/loopback/navigation policies, package inclusion, actual NSIS schema validation, registry/integrity/Git-free build dependency boundary |

## Actual slicing evidence and boundary

[Actual 22.12-second browser recording](guided-workflow/actual-offline-slicing.webm) and [actual browser report](guided-workflow/actual-browser-slicing.json) show the pinned **Bambu Studio 2.8.2.61** subprocess, three explicitly oriented fixture copies, generated native 3MF and the visible native-review requirement. No injected runner was used for this case.

The separate reproducible software smoke command is recorded in [runtime-evidence.json](guided-workflow/actual-slicing/runtime-evidence.json):

```bash
CATALYST_SLICER_CONFIG=/tmp/catalyst-bambu-runtime/config.json \
LD_LIBRARY_PATH=/tmp/catalyst-bambu-runtime/deps/usr/lib/x86_64-linux-gnu:/tmp/catalyst-bambu-runtime/squashfs-root/bin \
LC_ALL=C npx tsx scripts/smoke-slicer.ts docs/guided-workflow/actual-slicing
```

It passed, exit 0, with **three copies**, **90° X orientation**, **240 native body layer markers**, **242 supported extrusion-height groups** and **97,907 parsed linear segments**. Extra height groups include startup extrusion; they are not substituted for the native layer count. Unsupported machine macros, arcs, homing and related issues keep `canApprove:false` and `previewSupported:false`. No unsupported command was deleted or declared safe to force approval.

Final standalone smoke artifact hashes (the later browser experiment has its own output hashes):

- G-code: `0dc48a3e7adc0135651e1f2f30d915b2cd8c681eaac20cce0eb25fcffd4bc949`
- Native 3MF: `fb165adbcd445b423928b750ff611bf948fee24d90b66aa1fb85a6282122904f`
- Prepared 3MF: `182ccc57c28e4fd15ca741871dc42745fd3d3a9993f1e149365a52e9ccbe54ed`
- Resolved profile bundle: `891fedb37ecb7b3bc6c249b18dfe89da989ccd8300d176e2ba7c6941cbace053`

[geometry-roundtrip.json](guided-workflow/actual-slicing/geometry-roundtrip.json) independently compares all three native instance mesh bounds/transforms with prepared 3MF: **0.0 mm maximum difference**. The upstream binary asset digest was verified; initial missing libraries and genuine exclusion-area rejection are retained in runtime evidence. Dependencies were extracted under `/tmp`; no system/security configuration changed.

All actual-slicing artifacts are **NON-MANUFACTURABLE** because CAD is fixture data and the machine/filament profiles are untested examples. The native review download is not an approved release. Private Onshape → qualified profile → completely inspectable output → production approval has not been demonstrated.

## Windows delivery and outstanding qualification

**No Windows EXE was built, installed or launched here.** Linux has no Windows, Wine, PowerShell, graphical display or downloaded Electron renderer runtime. The requested fallback is delivered: corrected source, secure Electron host, offline assets/service bundle, NSIS x64 configuration/icon, native build script, isolated installation/two-launch verifier and [ROG handoff](ROG_AGENT_HANDOFF.md). The actual native verifier records installation, renderer isolation, real save/second-launch reopen, installer SHA-256 and Authenticode status. Those Windows reports do not exist until the ROG agent runs it.

Required next native commands are documented in [WINDOWS.md](WINDOWS.md):

```powershell
npm ci
powershell -NoProfile -File .\scripts\windows\Build-Installer.ps1 -SkipDependencyInstall
powershell -NoProfile -File .\scripts\windows\Verify-Installer.ps1 -Installer .\release\Catalyst-Foundry-0.1.0-x64-Setup.exe
```

Native GPU, file picker/download, normal launch, install/uninstall/upgrade and the full browser workflow still need Windows acceptance. No setting is changed to bypass trust policy; no signing identity is created.

## Remaining limitations and evidence

No remaining reproduced blocker was observed in the tested supported-import/fixture review/export/reopen workflow. The following remain material limits:

- Authorised private Onshape access is untested; external OAuth login/refresh setup is required. Live automatic CAD revision comparison and microversion-only linked intake remain deferred. Human document/version display names are not fully hydrated; exact IDs, part names, configurations and root/child context are retained.
- Actual Bambu slicing works in the recorded Linux setup, but its full machine program cannot be approved in Foundry. Unsupported native outputs persist in worker history/downloads; until a supported result is attached, they are not embedded in portable project exports. Physical profile qualification is not implemented, and configuration remains `tested:false`.
- Orientation/placement are disclosed conservative bounds heuristics, not mesh contact/support analysis, load inference, weak-point analysis, FEA or strength validation. No time/material comparison is invented.
- Reviewer identities are local/self-reported; no authenticated multi-user workflow or digital signature. External G-code mapping remains operator attestation. The local service stores one workspace; browser draft storage is bounded.
- Printer dispatch/feedback, machine acceptance, numerical simulation automation, additional geometry formats, multi-plate/per-object processes and machine-specific laser integration remain deferred.
- The JavaScript bundle needs future performance splitting; cloud software rendering with recording is slower than hardware.

[Guided desktop](guided-workflow/guided-start-desktop.png) · [Mobile](guided-workflow/guided-start-mobile.png) · [Preparation](guided-workflow/guided-prepare-desktop.png) · [Complete 57-second fixture workflow recording](guided-workflow/complete-workflow.webm) · [Actual offline slicing recording](guided-workflow/actual-offline-slicing.webm) · [72-row requirements audit](REQUIREMENTS-AUDIT.md).

The final demonstration export contains **10 files**. All **9 listed SHA-256 checksums** and ZIP integrity were independently rechecked after the final browser export; the full approval/manifest seal is also asserted by the browser workflow. All three standalone actual-slicing artifact hashes were independently rechecked against the final report.
