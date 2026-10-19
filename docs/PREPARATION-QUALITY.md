# Foundry preparation quality update

Installed and restarted. Actual NSIS save/reopen, installed-file integrity, retained connections and an installed two-hole/color fixture transaction passed.

## Use

1. Keep using the cached CAD; no new Onshape download is needed for this correction. **Reslice existing plates once.** Older native results from the disconnected-face exporter are invalidated or rejected before handoff.
2. Use the narrow left tool strip to select/orbit, move, rotate, lay flat, place on a face or drop to the bed. Rotation opens beside the strip. **Auto prepare** stays visible at the upper right. Settings continue to expand without shrinking the canvas.
3. Open **Filament** in the canvas header. Choose a manual color without a printer, or explicitly pair a LAN status endpoint for reported AMS colors. New neutral drafts can use fresh matching printer/material colors; saved custom colors and existing results are not silently recolored. The selected color is included in the native file and hashed profile. Verify the final physical tray mapping in Bambu Connect.
4. Review the remembered printer/nozzle/plate/material, check **Printer checked**, then **Slice plate**. Changing manufacturing inputs invalidates approval. There is no printer-start action in this update.

## Corrected defects

- The old 3MF exporter assigned three distinct vertices to every triangle. Coincident edges were disconnected by index, and the native slicer filled holes despite the source mesh retaining them. The exporter now shares exactly equal coordinates without tolerance, snapping, face removal or geometry repair. A preparation version is bound into the exact slicer-profile identity, result and native attachment. Legacy native output cannot be reused as current or sent.
- The affected cached hardstop and original native model each had 996 triangles, 496 unique positions, consistent winding and two through holes. An isolated local comparison reproduced filled native bore cores before indexing and no extrusion across either corrected bore core afterward. Private CAD, its IDs, geometry and analytical images are excluded from this delivery.
- The huge toolbar panel came from a legacy full-height selector applied to every viewer child. Only the actual viewer now receives that height; tools use an explicit 42 px vertical strip and content height. Auto prepare retains absolute positioning despite generic button styles. Camera fitting reserves the actual strip width.
- Neutral tone mapping, white studio lights, matte material and crease-aware normals replace overexposed/tinted flat-facet shading. Parsing/normals/edges run in a worker. Source/edge buffers and exact manufacturing matrices are reused for moves and copies. Inactive geometry cache is capped at 64 MiB; active geometry remains valid. Pointer motion uses a plate-plane intersection instead of repeatedly testing mesh triangles. Redraws coalesce to one per screen frame and stop when idle; pixel count is capped at 1 million during interaction and 2 million at rest, at most 1/1.5 DPR respectively. Copy spacing participates in display invalidation. Native nozzle offsets align layer preview coordinates with model coordinates.
- Toolpath beads reuse endpoint/width/height arrays instead of allocating instance matrices, with six nominal top/side triangles instead of twelve box triangles per segment. This is display geometry only; source CAD, native sliced output, profile hashes and safety gates are unchanged.
- The rejected metal-pour illustration is replaced by a minimal Foundry title, small Catalyst mark and one 1400 ms crimson loading line. Native and React startup share the same art/styles and wait for finite animation completion. Loading stages reflect engine/workspace work; reduced motion is static with a 400 ms minimum. No video, filters, canvas or animation dependency.

## Verified outcomes

- Native Windows x64 / Node 24.22.0 build exit 0; typecheck and **375 tests in 40 files** passed. Original lockfile SHA-256: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973.
- Synthetic CPU placement setup for a 24,576-triangle fixture fell from 109.32 ms median with repeated edge rebuilding to 0.09 ms with cached geometry/frames. For 250,000 path segments, instance data fell from 16 MB to 8 MB and triangles from 3 million to 1.5 million. The standalone offscreen WebGL fixture compiled the real production bead shader, drew actual pixels with no errors and one draw call, and recorded synchronized pixel-readback timings on this laptop's RTX 5070 Ti. These are synthetic setup/render measurements, not actual Foundry interaction FPS or low-end laptop validation.
- Six real pinned Bambu Studio 2.8.2.61 offline public-fixture slices passed: X1/X2D two-hole plates and both normal/tree required-plus-backup support cases. Each two-hole output has zero extrusion crossings through the inner 4 mm bore cores and approximately 2.976 mm minimum extrusion-edge clearance. All native 3MFs retain the selected blue/brown filament color. Exact source/profile/manifest/toolpath/native-project hashes are retained.
- Isolated packaged save/reopen each exited 0. Actual visible startup intervals: 1415.28 / 1482.98 ms; finite animation completion confirmed. Reduced-motion reopen exited 0 with 416.35 ms visible presentation.
- Current packaged desktop/service/startup/production assets and all three processing workers match; all 6248 runtime files and 12 catalog profiles verify.
- Synthetic LAN tests cover certificate pinning before credentials, fragmented MQTT parsing, the fixed status-only request, private-address limits, oversized/malformed packet rejection, presence bits, stale/mismatched material handling, vault persistence and late-response disconnect races. No real printer was contacted.
- Actual native NSIS installation/save/reopen and normal update passed. GitHub/Onshape connections and the last-used printer profile survived. The actual installed HTTP service sliced the public two-hole fixture in the requested color, with zero new Onshape calls.
- The first normal-path restoration returned NSIS code 2 in the previous-installation atomic rename step. The previous installation was the deeply nested isolated verification target. Its scoped native uninstaller returned 0 with app-data preservation; a fresh normal-path installation and a separate in-place update at that normal path then both returned 0. Shortcuts and installed files were checked before the normal app reopened. The failed attempt is retained, not reported as a successful install.

## Limits

The application UI, perceived shading/animation, actual app interaction FPS, low-end laptop FPS and physical printing remain **untested** under the user's no-Foundry-UI-automation instruction. The separate synthetic renderer used an isolated hidden Electron window and public generated data; it never loaded or operated Foundry. No screenshots, recordings or browser UI automation were used.

Live printer/AMS/firmware compatibility is **untested**. LAN pairing uses the operator's existing access code and an explicitly pinned certificate, stored through the desktop encryption vault. It reads status only. Standard AMS IDs 0-3 and reported external-spool data are parsed; special AMS HT IDs or new firmware schemas may need extensions. Cloud login and actual tray mapping stay in Bambu Connect; cloud AMS telemetry is not implemented. Manual color remains available. See docs/PRINTER-STATUS.md.

The first isolated native fixture attempt used a work path too long for the Windows slicer's file opening and failed with native code 4294967293. Shorter isolated paths passed all six cases; the original failure remains evidence. No Onshape allowance was consumed. No printer controls, credential creation, security-setting changes, publishing or repository pushes were performed.

The deeply nested verification installation exposed a native NSIS uninstaller atomic-rename failure. Normal installation and in-place updating at the default shorter per-user path were separately verified afterward. Arbitrarily long custom installation paths remain unverified; use the default location. No manual registry deletion, security-setting change or broad filesystem cleanup was used for recovery.

Installer: Catalyst-Foundry-preparation-quality-0.1.0-x64-Setup.exe

SHA-256: 45e1bdc5086d34e00521a2a2d1363b90171eb767606462772a456cdc6ff32a1c
