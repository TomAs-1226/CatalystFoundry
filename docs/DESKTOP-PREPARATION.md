# Foundry slicing and preparation correction

Built candidate; packaged startup/save/reopen checks pass. Your running app remains the previous workflow version pending save/restart confirmation. This candidate has not yet passed NSIS installation or normal-session acceptance.

## What to do

1. Open Team parts and choose the required parts for a draft plate. Newly added make parts are arranged when they fit; the CAD remains available if the batch needs splitting.
2. The slicing bar shows the remembered printer/material, nozzle and plate. Check **Confirm this printer, nozzle, plate and filament** for this plate. Change **Printer & material** if necessary. Confirming does not attest that the physical printer is ready.
3. Leave **Auto arrange before slicing** on, or choose **Arrange now**. Packing centers the required/backup copy grids on the bed, puts them at Z=0 and keeps the selected rotations and original geometry. Uncheck automatic arrangement to retain manual positions. A batch that cannot fit reports a specific split/rotation/quantity error and never applies a partial layout.
4. Choose **Automatic recommendation**, **Tree**, **Normal**, or **Off** in Supports. Automatic inspects oriented downward-facing mesh triangles: broad flat roofs start with normal support; smaller overhangs start with tree support. Bambu generates the actual support paths. This is an editable heuristic, not proof of optimal supports, accessibility, strength or print quality. Existing projects that explicitly had supports off retain Off; new jobs start with automatic supports.
5. Click **Slice plate** once. It applies the confirmed printer, arranges, resolves support and process settings, prepares exact geometry and queues the job. Stage messages stay visible. Update after edits waits for valid, confirmed inputs; approval and printing never occur automatically.
6. Inspect the output and native command limitations. Review in Bambu Connect remains available for full native inspection and the operator's final action. Fixture CAD remains non-manufacturable.

## Reproduced slicing defect

A public fixture submitted through the actual installed prepare/queue/status APIs failed at 0% with **Slicer input/output must remain inside the configured work root**. Windows redirected new files under Roaming into the Codex package cache, but resolving the parent directory alone returned the unredirected path. The worker therefore rejected its own prepared file.

Startup now creates an exclusive temporary marker in the trusted configured work directory, resolves the actual file location and removes the marker before constructing any prepared paths. All subsequent input/output checks still enforce the canonical root, hashes, symlink confinement and exact profiles. Browser-provided executable or filesystem paths remain disallowed. Redundant capability probes in profile/prepare routes were removed; the complete profile and runtime checks still run.

The slicing transaction now uses the current project reference directly rather than waiting for later React renders or another click to apply process hashes. Edits, changed job selection, a missing confirmation or a mismatching prepared manifest stop queueing.

## Printer memory, startup and graphics

The service exposes the restored catalog identity from its existing persisted, reviewed bundled configuration. The desktop selects it on reopening and requires a new confirmation for each plate/session or changed hardware/material. External configured profiles remain supported.

A sandboxed local Foundry startup screen appears before the service and runtime checks finish. It has no script or network access. The mark draws once and a small compositor-only loading line runs during startup; reduced motion disables it. There is no artificial delay. The React recovery screen uses the same design.

Charcoal/crimson surfaces and the large canvas remain. Material lighting is slightly softer, with a 1024 shadow map replacing 2048. Rendering stays event-driven, the pixel-ratio cap stays in place, and no post-processing pass or continuous 3D animation was added. Visual polish and actual GPU performance are untested under the no-UI-automation instruction.

## Actual validation

- Native Windows x64 / Node 24.22.0: final Build-Installer.ps1 exit 0; typecheck and **358 tests in 36 files passed**. Original lockfile SHA-256 unchanged: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973.
- Real pinned Bambu Studio 2.8.2.61: X1/PLA normal, X1/PLA tree, X2D/PLA normal and X2D/PLA tree all succeeded on the public T-roof fixture through the previously failing Roaming work root. Every output contains actual Support/Support interface features. Geometry, complete profile, manifest, native-project and toolpath hashes are retained in preparation-native reports.
- Regression checks cover centered packing, required/backup copies, preserved rotations/bytes, failed-fit atomicity, support style/angle mapping, support-bound manifest invalidation, directory aliases and cleanup, one confirmed transaction, changed-input races, missing confirmation, and existing CAD/cloud/approval/export boundaries.
- Existing isolated packaged save/reopen checks both exit 0. Packaged main/runtime/startup/service/UI assets and all 6248 runtime files plus 12 catalog profiles are checked. This establishes startup/security and persistence; it does not exercise the interactive workflow.
- NSIS installation, normal-session restart/connection retention, and the final installed HTTP transaction remain untested for this candidate until save/restart is confirmed.
- No private CAD was fetched for this work, no credentials were created, and no printer was contacted. The GitHub website and Cloudflare service were not changed. Cloud CAD reuse and the Onshape quota controls remain in place.

## Remaining limits

Interactive UI operation, screenshots, recording, browser execution of the preview worker, actual GPU frame rate, low-end laptop behavior, the user's private whole-robot CAD and physical printer acceptance remain untested. Native outputs contain machine-specific commands that Foundry cannot fully approve; incomplete previews stay blocked for Foundry approval and require native review. Automatic placement preserves rotation; it does not infer structural load direction or optimal print orientation. Support choice is a bounded geometric rule and still needs inspection. Existing mesh/G-code size limits and conservative collision checks remain.

Installer: Catalyst-Foundry-preparation-0.1.0-x64-Setup.exe

SHA-256: 333d34759e93ba1e136cbb6aff2b8b54ce1b9e970f6cd8b5349ada4f63747e3b
