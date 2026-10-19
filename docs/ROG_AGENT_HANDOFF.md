# ROG agent handoff: Foundry Windows validation

The user explicitly requested a corrected-source handoff if Windows validation was unavailable in the cloud. This is that handoff. **Do not describe the installer as built or validated until the native steps below succeed.** Work only in the ROG agent's authorised environment. Do not operate printers, create credentials, connect accounts without authorisation, change security settings, publish, push repositories or inspect unrelated personal files.

## Supplied implementation

- `electron/main.cjs`: single-instance desktop shell; bundled local service on an ephemeral `127.0.0.1` port; per-user data; sandboxed renderer; shutdown handling; isolated native installation smoke mode.
- `electron/runtime.cjs`: tested host/origin, navigation, filesystem and smoke-mode policies.
- `electron/server-entry.ts` and `scripts/windows/build-desktop.mjs`: bundle the current service and its dependencies together with local production UI assets.
- `packaging/electron-builder.cjs` and `packaging/assets/`: Windows x64, per-user NSIS configuration; unsigned unless an authorised certificate is supplied; no updater/publishing; app-data preservation.
- `scripts/windows/Build-Installer.ps1`, `Verify-Installer.ps1` and `Start-Foundry.ps1`: reproducible build, actual install/two-launch verification and process-local configuration paths.
- `tests/desktop.test.ts`: regression coverage for desktop trust boundaries and package inclusion/exclusion.

## Execute and retain evidence

1. Use native Windows x64 with Node 24.19 or newer in the 24 LTS line. Extract the corrected source in a new writable directory. Run `npm ci`; preserve the lockfile. Run `powershell -NoProfile -File .\scripts\windows\Build-Installer.ps1 -SkipDependencyInstall`. Fix actual failures without weakening tests.
2. Run `powershell -NoProfile -File .\scripts\windows\Verify-Installer.ps1 -Installer .\release\Catalyst-Foundry-0.1.0-x64-Setup.exe`. Retain the generated `launch-save.json`, `launch-reopen.json` and `verification-summary.json`, exact command/exit codes and installer SHA-256. The verifier uses an isolated profile; it does not open the user's workspace project.
3. Open the installed app normally. Verify guided source/preparation/toolpath/review/export steps, file picker/download behavior, responsive windows, 3D camera and actual GPU rendering. Save and reopen a portable project. Confirm disconnected integrations and fixture/demo labels are visible. Capture screenshots and a short actual workflow recording.
4. Run the complete browser suite with a supported Playwright browser on Windows. If the cloud config selects `/usr/bin/chromium`, override/configure the Windows browser path as documented in the current README rather than assuming that Linux path exists. Check unit conversion, nested/repeated CAD quantities, failed import recovery, orientation/profile invalidation, changed/revoked toolpath mappings, duplicate approval/export and persistence.
5. Only after separately authorised integration setup, exercise live immutable Onshape intake against a shared test document and real offline Bambu slicing with a reviewed, pinned, complete profile. Do not invent credentials, loads, simulation results, profile validation or machine acceptance. Record exact CAD IDs/version/configuration, geometry hashes, slicer version and profile hashes, resulting toolpath hash and limitations. Keep credentials and private document contents out of logs shared externally.
6. Return the built EXE, SHA-256, exact test/build/install/launch outcomes and unresolved defects. If any native check is unavailable, label it untested. Build success alone is insufficient.

## Expected safety behavior

Manufacturing-relevant changes must stale the matching toolpath and invalidate approval. Approval binds the exact immutable source/configuration, bytes/hashes, quantities, orientations, machine/nozzle/plate/material and slicer/settings/output. Fixture CAD and manually authored demonstration G-code must remain non-manufacturable. Export/assignment does not report printing. No printer-start action is part of this handoff. Physical checks must remain explicit operator attestations.

See [WINDOWS.md](WINDOWS.md) for storage, integration paths and command details. See the repository's current verification report for exact Linux results; do not copy those results as evidence of Windows installation.
