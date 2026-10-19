# Catalyst Foundry

Windows preparation, offline slicing and exact-job review for robotics teams. Foundry uses Catalyst's charcoal and crimson desktop interface, with a large 3D plate and expandable settings.

**Internal preview.** Software tests and native fixture slices do not certify printer/filament compatibility or physical manufacturing. Fixture CAD and demonstration toolpaths stay non-manufacturable. No import, approval, update or export starts a printer.

## Use

1. Install the Windows x64 EXE from [Releases](https://github.com/TomAs-1226/CatalystFoundry/releases).
2. Use **Add robot** or Team parts. Connect the team's sync URL and Onshape account when needed. Shared immutable geometry is cached locally for offline use; reusing it does not download it from Onshape again. New sources/changed versions need explicit intake and can require several API requests. Onshape's own quota is authoritative.
3. Select parts, quantities and backup copies. Auto prepare arranges and orients the exact geometry. Move, rotate, lay flat and on-face tools support manual adjustments. Advanced process controls expose walls, shell layers, speed, infill, support and brim settings.
4. Slice with the included pinned Bambu Studio engine and resources. Inspect actual generated layers, confirm the immutable manifest and perform the required operator checks. Review keeps monitoring and can recover a matching saved slice when you change screens.
5. Use native handoff to official Bambu Connect, then review the actual file, target and materials there. Its cloud login/LAN pairing and final Print action remain inside Connect. Foundry cannot infer Connect's login state or printer acceptance.

Completed automatic saves and **Save progress / Ctrl+S** write this laptop's project, independently of the desktop's changing loopback port. Export project creates a portable recovery file with geometry and review history. Team manufacturing records are a separate sync feature.

**Camera options → 3D quality → Low power** reduces display cost without changing manufacturing geometry or toolpaths. Automatic mode lowers moving-scene resolution and avoids expensive shadows for dense scenes. Repeated plate copies share instanced meshes; layer scrubbing reuses transferred GPU buffers.

**Project → App updates** checks signed internal releases. Downloads are verified in the background; **Save & restart** is explicit and unavailable during active slicing. The first upgrade from a 0.1.0 build needs a normal installer. See [desktop updates](docs/UPDATES.md).

## Build on Windows

Use native Windows x64 and Node.js 24.19+ in the 24 LTS line (the pinned CI runtime is 24.22.0).

~~~powershell
npm ci
powershell -NoProfile -File scripts/windows/Build-Installer.ps1 -SkipDependencyInstall
powershell -NoProfile -File scripts/windows/Verify-Installer.ps1 -Installer release/Catalyst-Foundry-0.2.1-x64-Setup.exe -EvidenceDirectory C:/Foundry-QA/evidence -InstallDirectory C:/Foundry-QA/app
~~~

Use a fresh short verification target. NSIS uses the same application identity as a normal installation; save and close any existing Foundry work before installation checks. Build success alone is insufficient: retain actual install and isolated save/reopen evidence.

The builder downloads the pinned official Bambu Studio archive and corresponding source, checks their SHA-256 values, and packages the complete runtime/catalog/license resources. It does not require a local Bambu Studio installation. Official Bambu Connect is a separate optional vendor download with byte and publisher checks; its proprietary binary and credentials are not redistributed in this repository.

~~~powershell
npm run typecheck
npm test
npm run dev
~~~

The complete browser suite is **npm run test:e2e**. On Windows, install a supported Playwright browser with **npx playwright install chromium** or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an existing Chromium executable; never assume Linux's /usr/bin/chromium exists. Follow [WINDOWS.md](docs/WINDOWS.md) for detailed paths and integration setup.

## Repository and releases

This public repository contains application source and synthetic fixtures. User CAD, credentials, pairing codes, local result.json, runtime data, private evidence, protected signing keys and generated vendor binaries are excluded. Previous cloud UI recordings and generated demonstrations remain outside the tracked release source.

GitHub Actions runs native Windows build/unit/install checks. Publishing a signed internal prerelease requires an explicit workflow dispatch with Publish enabled and the repository's protected signing secret. It does not publish on ordinary pushes or PRs. The installed Windows EXE is currently unsigned with Authenticode; the separate Ed25519 update signature verifies OTA artifacts and does not represent a Windows publisher certificate.

See [internal release notes](docs/INTERNAL-RELEASE.md), [printing integration](docs/PRINTING.md), [bundled slicer](docs/BUNDLED-SLICER.md), and [update protocol](docs/UPDATES.md). Live CAD, UI/GPU, physical printer/AMS and machine-acceptance checks require their own evidence. No zero-defect or physical-qualification claim is made.
