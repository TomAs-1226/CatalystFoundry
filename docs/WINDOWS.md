# Windows desktop packaging and verification

**Windows handoff update:** Foundry now bundles the official Bambu Studio 2.8.2.61 runtime, its matching profile tree, twelve resolved mappings and upstream source/license notices. See [BUNDLED-SLICER.md](BUNDLED-SLICER.md). Use the accompanying native Windows validation report for actual build/install/launch results. The original cloud-environment statements below describe the supplied handoff, not new Windows evidence. No physical profile is qualified by bundling.

This repository includes a native Windows x64 NSIS installer configuration and verification scripts. See [WINDOWS-NATIVE-REPORT.md](WINDOWS-NATIVE-REPORT.md) for the built artifact, native install/two-launch evidence and remaining untested checks. The original cloud checks below are historical Linux evidence and do not establish Windows installation success.

The installed app includes Electron, the production React assets, the offline Bambu runtime and profiles, and a bundled Express service. Users do not need Node.js or a separate Bambu Studio installation to run it. Node/npm are needed only to build from source. Onshape credentials are not included. Optional native printing handoff uses a separately installed Bambu Connect; see [PRINTING.md](PRINTING.md). Connect owns final printer selection and Print.

The dependency lock uses the published registry release of the otherwise unused `@electron/node-gyp` rebuild helper, pinned through an npm override, to avoid an upstream Git/SSH fetch during clean installation. That registry release is not claimed to be byte-identical to the upstream Git commit. This package disables native dependency rebuilds (`npmRebuild: false`) and bundles only JavaScript service dependencies. If native Node add-ons are introduced later, requalify this override and the Windows native build toolchain. The current locked dependency installation does not require Git or SSH.

## Build on the ROG agent

When retaining installation evidence under a deeply nested workspace, pass a short, new absolute `-InstallDirectory` to `Verify-Installer.ps1`, separately from `-EvidenceDirectory`. Upstream NSIS uninstall/rename and bundled resource paths can exceed Win32 path limits in long custom targets. The verifier rejects an existing target and still uses an isolated data profile. Verification shares the app identity with the normal installation, so save current work before running NSIS. Use the default short per-user location for the normal app.

Use a native Windows x64 environment with Node.js **24.19 or newer in the 24 LTS line** and npm installed. This matches the cloud-tested runtime and supports the environment-proxy flag used by the local server scripts. Initial dependency installation and Electron/NSIS downloads require internet access. Keep this work in an ordinary writable checkout; do not build inside the installed application directory.

The build prepares and hash-checks the official portable engine when it is absent. `Prepare-Builder.ps1` extracts only the Windows tools from the pinned resource/signing archive, avoiding its unrelated macOS symlinks and their privilege requirement. It also prepares NSIS using electron-builder's pinned checksum. The cache is process-local under `.build-cache/`; Windows security settings are not changed.

```powershell
npm ci
powershell -NoProfile -File .\scripts\windows\Build-Installer.ps1 -SkipDependencyInstall
```

The script runs type checking, unit/integration tests, the production UI build, the bundled service build and `electron-builder`. It stops on failures. Expected output:

```text
release\Catalyst-Foundry-0.1.0-x64-Setup.exe
release\Catalyst-Foundry-0.1.0-x64-Setup.exe.sha256
```

The package is unsigned unless an authorised signing identity is configured independently. No signing identity or certificate is created by these scripts. An unsigned development installer may produce Windows trust warnings. Do not change security settings to bypass organisation policy; signing and distribution are separate tasks.

Equivalent packaging commands are `npm run desktop:prepare` and `npm run dist:win`. `desktop:prepare` is cross-platform preparation only. `npm run desktop:dev` starts the production desktop assets with the development Electron binary; it is not installation verification.

After preparation, `node scripts/windows/verify-bundle.mjs` checks the bundled local service under Node without a TypeScript loader: offline index delivery, actual disk save/new-service reopen, loopback origin enforcement, disconnected integrations and graceful shutdown. It explicitly does not launch an Electron renderer or validate Windows installation.

## Verify the actual installer and two launches

Run the generated installer in an isolated test install directory through the verification script. It installs per-user without requesting administrator privileges. It does not uninstall or overwrite the user's usual installation, read an existing project, connect accounts, slice, dispatch jobs or operate printers.

```powershell
powershell -NoProfile -File .\scripts\windows\Verify-Installer.ps1 `
  -Installer .\release\Catalyst-Foundry-0.1.0-x64-Setup.exe
```

This performs a real NSIS install, then launches the installed `Catalyst Foundry.exe` twice. Both phases share one new isolated application profile and local data directory, separate from normal user data. The first launch mounts the production renderer, confirms browser Node APIs are unavailable, checks cross-origin rejection and saves a project through the real local service. The second process reopens the same project from disk. It writes `launch-save.json`, `launch-reopen.json` and `verification-summary.json` in a new temporary evidence directory. The summary includes the installer SHA-256, Authenticode status, Windows version and project ID. Preserve those reports as evidence. A script/config test on Linux is not a substitute.

After the scripted checks, launch the installed app normally and inspect the guided workflow at the actual display scaling and GPU configuration. Repeat the browser acceptance workflow against a local desktop build, import/reopen a portable project and export an approved demonstration package. Confirm demonstrations remain labelled non-manufacturable. Verify no machine-start or cloud dispatch action is offered. Record any Windows-only WebGL, file download, permissions or filesystem issue before declaring validation complete.

The scripted installation smoke verifies installation, renderer isolation and persistence. The full browser workflow suite remains a separate check (`npm run test:e2e` after configuring Playwright's supported browser). Live Onshape and real Bambu slicing also require the setup and qualification below.

## Desktop storage and lifecycle

Normal user data lives under Electron's per-user directory, usually `%APPDATA%\Catalyst Foundry`. The project is stored in `data\project.json`, slicing recovery state in `data\slicing-jobs.json` and desktop startup logs in `logs\desktop.log`. Portable project export is the supported backup/transfer path. Uninstall preserves user data. This version stores one workspace project; it is not a multi-user service.

The packaged local service binds only `127.0.0.1` on an OS-assigned port. The renderer has no Node integration, uses context isolation and the Chromium sandbox, and accepts only its own local service origin. External HTTPS links open in the user's browser; file, executable and script schemes are rejected. The service closes on exit and asks the slicing service to cancel owned work. A second normal launch focuses the existing window. There is no auto-updater or publishing step.

## Authorised Onshape and reviewed slicer setup

The default installation is disconnected. Read [Onshape setup](ONSHAPE.md) and [slicer setup](SLICING.md) first. The desktop launch inherits integration environment configuration from its parent process. The packaged helper `resources\setup\Start-Foundry.ps1` can set the two supported configuration **file paths** for that process only:

```powershell
powershell -NoProfile -File "C:\path\to\Foundry\resources\setup\Start-Foundry.ps1" `
  -OnshapeTokenFile "C:\private\authorised-onshape-token.txt" `
  -SlicerConfig "C:\reviewed-profiles\foundry-slicer.json"
```

These are examples of local paths, not credentials to create or paste into chat. Obtain authorised Onshape access through the documented setup; the application does not create accounts or provision OAuth credentials. The token remains in the server-owned file and is not sent to the renderer. The helper never reads the token or changes persistent environment settings. Exit a running instance before changing integration configuration. Launching the ordinary shortcut without a configured parent environment returns to disconnected mode.

Use absolute Windows paths in the reviewed slicer configuration. Install the pinned Bambu Studio version separately and provide complete matching machine, filament and process profiles. A detected executable and syntactically valid JSON do not constitute a physically validated printer profile. Confirm the actual CLI version/output and qualification checks in [SLICING.md](SLICING.md); exact machine/nozzle/plate/filament choices remain the team's responsibility. The app exports packages for operator-controlled manufacturing and does not verify loaded material, nozzle, plate, machine state or bed clearance.

See [ROG_AGENT_HANDOFF.md](ROG_AGENT_HANDOFF.md) for the remaining native acceptance work and evidence checklist.

## Cloud checks performed

On Linux with Node 24.19.0, `npm run desktop:prepare` completed the UI/service bundle; `node scripts/windows/verify-bundle.mjs` passed the real local service smoke; `npx vitest run tests/desktop.test.ts` passed all eight desktop regression tests, including the pinned builder's schema and registry-only dependency lock. JavaScript syntax checks passed with `node --check` for `electron/main.cjs`, `scripts/windows/build-desktop.mjs` and `scripts/windows/verify-bundle.mjs`.

A separate clean temporary directory containing only this `package.json` and lockfile completed `npm ci --ignore-scripts --no-audit --no-fund` with `npm_config_git` set to a deliberately nonexistent executable: 523 packages installed in 12 seconds. This establishes that dependency resolution/fetching does not require Git or SSH. Lifecycle scripts were deliberately omitted; Electron/NSIS downloads, PowerShell execution, EXE building, actual installation and renderer launch still require native verification. Upstream packaging dependencies emitted deprecation notices; those notices are not presented as Windows validation.
