# Foundry plate workspace correction

Installed and restarted in your normal app; native installation and actual installed API acceptance passed.

## Use

1. Open the draft plate and choose **Auto prepare** beside the canvas. Unlocked parts are laid onto a mesh face and all required/backup copies are packed at Z=0. The rule considers contact area, height and downward faces; it does not infer loads or guarantee the best structural orientation.
2. Use **Move** to drag a part and its copies, **Rotate** for X/Y/Z turns, **Lay flat** for a geometric suggestion, **On face** then click a specific face, or **Drop** to seat the current rotation. Numerical transforms and copy spacing remain in Part settings. Manual rotations and picked faces stay fixed in automatic preparation. Turn off Arrange before slicing to retain manual XY placement.
3. Click the printer label to review the remembered mapping. **Settings** opens a 320 px popover for normal/tree/automatic/off supports, automatic arrangement/orientation and update-after-edits. Layer height, walls and infill remain accessible there. Settings and the inspector overlay the canvas instead of shrinking it; the bottom slicing bar stays compact.
4. Check **Printer checked**, then **Slice plate**. Confirm the listed printer, nozzle, plate and filament for every plate/session. Review generated supports and orientation; the checkbox is not an attestation that the physical bed is ready.
5. Toolpaths default to filament color with a distinct support color. **Line type** restores feature colors. Travel is off by default and can be enabled. The bead display uses native width/height metadata where present, with nominal nozzle/layer fallbacks; it is a visual approximation of deposited material, not flow or machine simulation. Scrub actual slicer layers. Review/send remains an explicit Bambu Connect handoff; no printer operation was performed.

## Startup presentation

The logo draw starts only after the native window is shown. It remains visible for at least 1.1 seconds, overlapping engine initialization; slower starts add no extra hold. The React recovery screen keeps the completed mark static instead of restarting the draw during handoff. A browser start uses the same minimum interval while restoring data. Reduced motion keeps the mark static. Packaged smoke reports retain the actual visible-window interval; perceived timing/visual quality remains untested.

## Defects corrected

- Automatic placement previously translated parts without laying them flat. A bounded mesh-face/contact/height/overhang search now proposes a stable manufacturing orientation in a worker; source geometry and quantities remain unchanged. Reviewed manual choices are preserved. Actual triangle winding and conservative source bounds still limit the heuristic.
- The previous installed build failed the public required-plus-backup support fixture with native exit code 4294967195: gcode path conflicts between copy 1 and copy 2. Copies had a fixed 8 mm gap, including while supports were enabled. Automatic preparation now reserves at least 24 mm between supported copy bounds plus brim/margin clearance. Explicit spacing and every final instance position are persisted and manifest-bound (grid-v2); legacy layouts retain grid-v1 semantics. Conflicting native output still fails with a specific split/increase-spacing action; no collision check is bypassed. Clearance is a starting rule, not a guarantee for every support envelope.
- The preview skipped G2/G3 curves, including native P1 spiral travel hops, and inferred extra layers from support interface heights. It now tessellates validated single-turn XY centre-format arcs to <=0.02 mm chord error, honors native CHANGE_LAYER/Z_HEIGHT markers, and excludes setup/end motions from the print display. Unsupported planes, radius format, multiple turns, invalid centres and proprietary machine commands remain blocking for Foundry approval. Arc semantics follow [LinuxCNC's primary G-code documentation](https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g2-g3).
- Thin ghosted wire paths made supports and the model hard to read. Extrusions now use instanced filament-width/height beads; layer changes adjust visible instance counts without rebuilding buffers. Travel does not control toolpath camera bounds. Preparation and parsing run in separate workers; rendering remains event-driven with the existing pixel-ratio cap and no post-processing.
- Settings no longer occupy a tall scrolling area beneath the plate. Direct placement tools stay beside the canvas; exact profiles, support options, downloads and native handoff are in the compact settings popover.

## Actual checks

- Native Windows x64 / Node 24.22.0: final installer build exit 0, typecheck passed, **364 tests in 37 files passed**. Original lockfile retained: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973.
- Real pinned Bambu Studio 2.8.2.61: X1/PLA normal, X1/PLA tree, X2D/PLA normal, X2D/PLA tree all sliced **one required and one backup public fixture copy** successfully with native support features. Geometry, complete profile bundle, exact manifest, native project and G-code hashes are retained.
- All four real output files pass the new CPU preview audit: native layer markers match (120 normal / 80 tree), all print arcs are represented (269 normal / 7793 tree per machine), and layer scrubbing reuses buffers. Remaining proprietary machine commands keep approval blocked. CPU buffer preparation in this run took about 7-27 ms; this is not GPU performance or a low-end laptop result.
- Regression checks cover a tilted thin mesh laid to a real 4 mm height, required/backup packing, original-byte preservation, manual rotation retention, picked-face transformation, persisted/manifest-bound spacing, valid/invalid arcs, spiral hops, native layers, line dimensions, setup/end exclusion and existing CAD/cloud/approval/export boundaries.
- Isolated unpacked packaged save and reopen both exit 0. Package/service/startup/UI assets and both worker assets match; all 6248 runtime files and 12 catalog profiles verify. These checks do not establish interactive UI quality or GPU rendering.
- Actual NSIS installation/save/reopen and normal update passed. GitHub/Onshape status and the remembered printer survived. Two confirmed fixture transactions through the normal installed APIs succeeded: upright support generation and automatic lay-flat preparation; both added zero Onshape calls.
- No private CAD was fetched, credentials were not created, and no printer was contacted. No GitHub/Cloudflare deployment was needed.

Interactive visual quality, mouse/keyboard UI operation, screenshots/recording, browser/GPU execution, low-end laptop FPS, the user's whole robot CAD and physical printer acceptance remain **untested** under the no-Foundry-UI-automation instruction. Native print-command review and operator checks remain explicit. Automatic orientation/support selection is editable geometry advice, not proof of strength or optimal support.

Installer: Catalyst-Foundry-plate-workspace-0.1.0-x64-Setup.exe

SHA-256: 5c51ab77925d006c9b0f99716a3200ab37e3a07f1c4254687f7ab3947257fd42
