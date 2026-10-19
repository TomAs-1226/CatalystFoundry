> Superseded: the user rejected this visual direction. The current startup uses a minimal title and loading line.

# Foundry metal-pour startup update

Built and staged while the user tests the previous installed plate-workspace build. The normal app has not been replaced or restarted for this update. Native NSIS installation is untested for this candidate.

The startup sequence tips a crucible, pours molten metal into a casting channel and cools the fill into a steel bar. It runs once for 2600 ms. Real local-engine/workspace stages drive the small loading indicators; there is no invented numerical progress. A slower engine keeps its loading indicator visible after the pour finishes. Native startup waits for service readiness, the minimum visible interval and actual finite-animation completion. React recovery uses the same art/styles and preserves the completed composition after native handoff. Reduced motion uses a static cast bar and a 400 ms minimum.

The implementation uses CSS/SVG transforms and opacity with no animation library, video, filters or canvas. No slicing, CAD intake, manufacturing state or printing behavior changed.

## Actual checks

- Native Windows x64, Node 24.22.0: Build-Installer.ps1 -SkipDependencyInstall exit 0; typecheck, production assets and 364 tests in 37 files passed. Lockfile SHA-256 unchanged: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973.
- Isolated packaged save: exit 0, visible 2612.60 ms, 9/9 finite animations finished before navigation.
- Isolated packaged reopen: exit 0, visible 2615.15 ms, 9/9 finite animations finished before navigation.
- Isolated reduced-motion reopen: exit 0, reduced motion true, minimum 400 ms, visible 414.61 ms. Static presentation completed.
- Packaged main/runtime/startup/service and production assets match the current sources. Both processing workers are present; all 6248 bundled runtime files and 12 catalog profiles verify.
- No UI actions, screenshots, recordings, Onshape geometry calls or printer operations. The isolated smoke uses a separate profile without the user's credentials or project.

Perceived visual quality, actual GPU behavior and low-end laptop frame rates remain untested under the no-Foundry-UI-automation instruction. No native install/uninstall verification was run because the shared app identity can remove the running normal installation. The separate isolated packaged launch checks do not establish NSIS installation acceptance.

## Commands and outcomes

1. powershell -NoProfile -File scripts/windows/Build-Installer.ps1 -SkipDependencyInstall — exit 0 (source directory).
2. powershell -NoProfile -File work/check-metal-pour-unpacked.ps1 — exit 0 (workspace directory).
3. node work/check-metal-pour-package.mjs — exit 0 (workspace directory).

Installer: Catalyst-Foundry-metal-pour-0.1.0-x64-Setup.exe

SHA-256: b3864f6a743de7030b787a6264176bf0620d7ccaad5fd43ae58cd51722262a9f

