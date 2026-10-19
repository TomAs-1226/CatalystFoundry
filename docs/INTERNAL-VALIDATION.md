# Internal software validation

The 0.2.1 source passes 411 tests in 47 files and TypeScript checks on native Windows x64 / Node 24.22.0. Tests cover exact manufacturing/source/hash invalidation, native toolpath attachment and recovery, quantities/backups, API-budget guards, failed saves, ordered autosave writes, update signatures/download integrity, explicit restarts, and local preferences.

The actual compiled snapshot and preview workers were executed headlessly against six previously generated public X1/X2D native fixture outputs: two-hole, normal-support and tree-support plates. Exact save bytes, current approval/toolpath flags, stale-on-edit behavior, segment counts and all packed GPU arrays matched. This replay used existing immutable software fixtures; it was not a fresh CAD export, new slice, hardware test or browser-navigation test.

A public two-hole project main-thread heartbeat measurement recorded a maximum delay of about 57 ms with UI-thread serialization/currency checks versus 11 ms with the production snapshot worker. Exact save bytes and validation results matched. This is one headless CPU measurement, not a GPU/FPS or low-end laptop performance claim. Display meshes and toolpaths remain exact; visual-quality preferences never change the manufacturing manifest.

The live GitHub feed check initially returned HTTP 415 because release metadata used a binary Accept header. The native host now requests JSON metadata with the GitHub JSON media type, and the actual live feed check passes. Windows helper tamper rejection was exercised: wrong installer hashes fail before helper readiness, application closure or installer execution.

See each release's retained validation report for installer SHA-256, final package checks, native installation/launch and actual OTA outcomes. A successful build alone does not establish those outcomes. Historical cloud reports in this repository are dated evidence and do not establish current Windows installation.

The user has prohibited Foundry workflow UI automation. Manual navigation, visual appearance, GPU smoothness, the complete browser suite, live Onshape document intake, printer/AMS compatibility, physical printing and machine qualification remain separately untested. No testing here starts a printer or consumes Onshape CAD calls.
