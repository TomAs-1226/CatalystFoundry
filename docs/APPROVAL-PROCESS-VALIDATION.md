# Foundry native approval and advanced process update

Installed and restarted. Native NSIS installation, two isolated launches and normal installed-service acceptance passed.

## Use

1. Open your cached/imported CAD and run Auto prepare. Smart infill retains your density and walls, selecting Adaptive Cubic for larger lower-density geometry, Gyroid otherwise, or Rectilinear at 100%. This is a bounded geometry heuristic, not a strength/load calculation. Explicit manual native patterns take precedence.
2. Open Advanced Bambu settings → All Bambu process settings. Search the 261 pinned process controls, or expand Quality, Strength, Speed, Support and Other. Walls, top/bottom shells, infill, supports/interfaces, raft, brim/skirt, speeds and acceleration are included. Reset restores the selected profile's value. The inspector remains compact and collapsible.
3. Reslice the plate once after this update. Exact supported native layers attach before opening; Show layers explicitly retries an interrupted attachment. Changing CAD, quantity, placement, profile or settings stales the result. Withdrawn mappings cannot silently restore themselves.
4. Inspect actual layers and the full native 3MF's machine routines. On Approve, enter the reviewer, confirm layers and exact manifest, and check the real printer/nozzle/plate/filament/native routines under Confirm print setup. This is your operator attestation, not an automated physical qualification. The original tested flags remain false. Fixture CAD and demonstration G-code always remain non-manufacturable. The existing physical release checks remain required.

## Corrected defects

The native adapter and the independent worker both used to judge the complete Bambu program with the loose-import parser. Valid proprietary startup/shutdown routines caused supported output to be withheld, leaving no matching attached toolpath. Native mode now requires the matching single-plate 3MF, independent hashes and unique ordered executable/start/end boundaries, then checks the printable region. Full machine routines remain unchanged in the archive and require operator/native review. Unknown print commands, unsupported motion, missing units and conditional print motion still block approval. Loose imported G-code keeps the strict parser.

Navigation now follows successful attachment. An interrupted attachment has an explicit retry. A second issue classified every bundled unqualified real profile as a demonstration permanently: an exact operator setup attestation now enables real-job approval without inventing a physical test. Software fixtures remain demonstrations after that attestation. Advanced edits, setup changes and byte/provenance changes invalidate the matching review/approval.

Native process controls are generated from pinned 2.8.2.61 PrintConfig.cpp and process/UI keys, with types, native enums and ranges. Values are serialized into the complete resolved profile and included in the manifest/hash. Unknown fields, paths, custom scripts, machine and filament selectors are rejected. This is a process editor, not complete Bambu Studio parity: per-object painting, multi-filament assignments and custom scripts are outside this editor. Settings that emit unsupported motion still require native review and cannot bypass Foundry's parser.

Slice restoration now requests only matching metadata, followed by one selected result; it no longer clones/downloads every old G-code and native project to the renderer.

## Verified results

- Native Windows x64, Node 24.22.0: build/typecheck exit 0; 384 tests in 42 files passed. Original lockfile SHA-256: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973.
- Six actual pinned Bambu 2.8.2.61 offline slices: X1/X2D two-hole fixtures and normal/tree support required-plus-backup cases. Each native file preserved walls=5, top/bottom shells=5, requested speed/support-interface/brim values, selected color and resolved smart infill. The hole fixtures retain both bore cores with zero extrusion crossings in the inner 4 mm. Exact geometry/profile/manifest/toolpath/native hashes are retained.
- All six generated layer previews attach, review and approve as demonstrations only, survive exact portable save/reopen, and lose current approval after an advanced edit. These are public software fixtures; no physical qualification was created.
- Regression checks cover native-vs-loose parsing, malformed boundaries, conditional/unknown movement, exact archive mismatch, attachment/navigation/retry, revoked mapping, explicit operator attestation, fixture status, preserved physical-release gates, unsupported settings, native serialization, automatic/manual infill and lightweight matching-result queries.
- Packaged save/reopen/reduced-motion launches each exited 0 with the visible startup interval and finite animation completion checked. Desktop, service, production assets, three workers, all 6248 runtime files and 12 profile mappings match the build.
- Actual NSIS installation/save/reopen, installed-file integrity and normal app launch passed. Existing website/GitHub/Onshape connection status and last printer selection survived. A separate public fixture through the actual installed HTTP service sliced with advanced settings and color, attached native layers, retained demonstration approval across save/reopen and invalidated on edit. The Onshape counter did not increase.

The first new native check exposed a second worker-level full-file parse and failed; that check was retained as a recorded failure and the underlying worker validation was corrected. A dedicated regression test and the final six real native cases pass. A sandbox-only localhost test encountered EACCES; the authorized native loopback run passed all focused tests and the complete suite. Tests were not weakened.

## Limits

The app's visual behavior, interactive controls, complete browser suite, GPU interaction/frame rate, low-end laptop performance and physical print quality are untested under the user's no-Foundry-UI-automation instruction. No screenshots, recordings, printer starts, live AMS/hardware contact or new Onshape CAD calls were performed. No account credentials, private CAD or cached user G-code are included in the source/evidence delivery. The installer is unsigned. Advanced configuration outside the tested cases may emit unsupported output, which remains blocked from Foundry approval.

Installer: Catalyst-Foundry-approval-process-0.1.0-x64-Setup.exe

SHA-256: 45ed5d7729c42477e7bc08c30a78ab02aaf3a749ae77a12b0dcdae76c5769880
