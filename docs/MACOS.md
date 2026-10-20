# Mac packaging preparation (unreleased)

Native Mac candidates require an explicit GitHub-hosted run and passing per-architecture evidence. Hosted Apple Silicon and Intel builds/tests are authorized; the personal offline Mac is not accessed. No Apple credentials or certificates are created. Until a candidate passes its native checks, it remains unverified. Windows 0.2.2 remains the existing published release.

## Source identity

Desktop source: [TomAs-1226/CatalystFoundry](https://github.com/TomAs-1226/CatalystFoundry), base `16adc228baf750590bb25c21dd7404149e5e8ba1`. That revision was clean, committed and pushed before this preparation. The immutable Windows 0.2.2 installer was built from tag revision `13fdb1ee535760402ea848d8c09655c1228f06d5`; the subsequent commit changes release tooling. Mac/startup work extends that base. Each hosted candidate records its exact source revision; source changes are distinct from the immutable Windows release. Do not reuse version 0.2.2 for a new published build.

[CatalystFoundrySync](https://github.com/TomAs-1226/CatalystFoundrySync) is the separate website/sync repository. It is not the desktop application. Desktop source also contains shared sync code; no service deployment or API changes are required by this Mac preparation.

## Planned targets and current limits

| Target | Package | Status |
| --- | --- | --- |
| Apple Silicon, native `arm64` | Separate DMG and ZIP | Prepared configuration; native build/launch/slicing untested |
| Intel, native `x64` | Separate DMG and ZIP | Prepared configuration; native build/launch/slicing untested |
| Universal / Rosetta | None | Not prepared or qualified |

The initial packaging floor is macOS **13.5**, chosen conservatively for this toolchain. Electron 42's own documented floor is Monterey; this does not establish Foundry compatibility on that minimum. The standalone Node 24.22.0 build tools require macOS 13.5. Neither Foundry target is supported as a tested product until the native checks below pass on that architecture. Build each target on matching hardware with native Node. [Electron 42 platform support](https://github.com/electron/electron/blob/v42.0.0/README.md#platform-support), [Node 24.22.0 platform table](https://github.com/nodejs/node/blob/v24.22.0/BUILDING.md#supported-platforms), [electron-builder v26 architectures](https://www.electron.build/v26/docs/mac/#architecture-support).

This preparation uses native per-user Application Support paths and Electron secure storage. Sign in afresh on a Mac; Windows encrypted sessions/DPAPI blobs are not portable. The existing website/team account and cloud CAD library can then be used. Reusing cached immutable parts does not require another Onshape geometry download. Offline preparation remains separate from an online manufacturing reservation.

Windows NSIS OTA and the Windows Connect installer are explicitly disabled on Mac. Mac automatic updates and direct Connect handoff remain unavailable. A native sliced `.gcode.3mf` can be exported for operator-controlled review in an independently installed vendor application after that workflow is tested. No download, approval or export starts printing.

## Runtime prerequisites

Use the complete official **Bambu Studio 2.8.2.61** DMG, including its application, frameworks, resources and profile tree. No local Studio install/account is needed for the planned bundled CLI. No Windows executable is used on Mac.

- [Official DMG](https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/Bambu_Studio_mac-v02.08.02.61-20260820225108.dmg), 288329156 bytes, SHA-256 `cf648a95858fb630e1353c4987038df60d6caab693f18411fb95fb809f2d6926`.
- [Matching source tar.gz](https://codeload.github.com/bambulab/BambuStudio/tar.gz/refs/tags/v02.08.02.61), SHA-256 `fccea7043da48dfd05b98fdfc341cb29d0169880f3b3ae6bedf00ebfd3be7d28`. Its source, license and upstream notices are included with packaging.

These hashes identify upstream artifacts, not a successful Mac execution. Native preparation checks the archive hashes, mounts read-only, verifies the vendor signature/Gatekeeper assessment, inspects the executable/version and uses `lipo` on every detected Mach-O binary. A target is rejected if the complete vendor runtime lacks that architecture. The DMG's actual architectures have not been inspected on a Mac; a single DMG asset must not be called a tested universal runtime.

The original vendor app stays unmodified. Resolved profiles/catalog are generated outside it. Runtime inventories pin every file and relative symlink; paths escaping the bundle, changed entries and unexpected files are rejected. Signing must preserve vendor bytes. The packaged copy is rechecked afterward. Runtime hashes bind the manufacturing fingerprint; cross-platform runtime/profile changes require a new toolpath and review.

## Native build, only after Mac execution is authorized

Use a fresh writable source extraction, Node **24.22.0** (24.19+ within the 24 LTS line), npm, and current Xcode/Command Line Tools exposing `hdiutil`, `ditto`, `codesign`, `plutil`, `lipo`, `spctl`, `tar`, `xcrun notarytool` and `stapler`. No Docker/Windows cross-build is offered. Run in a logged-in native Mac session; headless vendor CLI compatibility is not assumed.

Obtain the two pinned official inputs above through an authorized download and retain them locally. `npm ci` preserves the supplied lockfile. The build accepts only explicit files and does not connect accounts, create keys, publish or install/restart the normal app.

```sh
npm ci
export CSC_NAME='Developer ID Application: YOUR EXISTING IDENTITY (TEAMID)'
npm run dist:mac -- --arch arm64 \
  --bambu-dmg /absolute/path/Bambu_Studio_mac-v02.08.02.61-20260820225108.dmg \
  --bambu-source /absolute/path/BambuStudio-v02.08.02.61-source.tar.gz
```

On an Intel Mac, use native x64 Node and replace `--arch arm64` with `--arch x64`. Do not run both targets from the same prepared vendor/output directory; keep a fresh extraction per candidate. Missing identities or archive/version/architecture/signature problems fail the build. `--unsigned-local` is an explicit local QA option that disables Developer ID signing/hardened runtime in that package only; it is not distributable, may be rejected by macOS, and must not lead to changing Gatekeeper/security settings.

The build runs the unit suite and production bundle, writes `release/mac-ARCH/Catalyst-Foundry-VERSION-mac-ARCH.dmg` and `.zip`, and records hashes in `package-build.json`. It records notarization, installation, native slicing and GPU checks as untested. It does not turn a build success into validation.

## Signing and notarization prerequisites

Distribution requires an **existing, authorized Developer ID Application identity** with its private key accessible in the build Mac's Keychain, plus an existing authorized notarization credential profile. No certificate, Apple account, password or API key is created by this preparation. A Windows OTA signing key does not replace Apple signing.

Signed distribution enables hardened runtime. The pinned Electron signing defaults supply helper entitlements; inspect the final signed entitlements and native launch result before accepting them. No debug entitlement or security-policy workaround is added. Vendor code retains its own signatures through `signIgnore`, and full vendor hashes are checked after packaging.

With authorized credentials already configured, submit the signed DMG, require `Accepted`, then staple and assess it. These commands upload the package to Apple and therefore need execution authorization; none has been run here:

```sh
xcrun notarytool submit release/mac-arm64/Catalyst-Foundry-VERSION-mac-arm64.dmg \
  --keychain-profile YOUR_EXISTING_PROFILE --wait --output-format json
xcrun stapler staple release/mac-arm64/Catalyst-Foundry-VERSION-mac-arm64.dmg
xcrun stapler validate release/mac-arm64/Catalyst-Foundry-VERSION-mac-arm64.dmg
```

Staple/validate the signed app too before making its final ZIP; rebuild that ZIP with `ditto -c -k --sequesterRsrc --keepParent APP.app FINAL.zip`. Verify the signature and Gatekeeper assessment on the actual mounted/downloaded distribution and retain final SHA-256 values **after** stapling/repacking. Refresh the build report hashes because notarization changes package bytes. Do not publish the earlier unstapled ZIP as the final candidate. [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [Apple diagnostics](https://developer.apple.com/documentation/security/resolving-common-notarization-issues).

## Required native evidence

After authorization and successful signing/notarization, test the actual DMG with a new isolated evidence directory:

```sh
node scripts/macos/verify-installer.mjs --arch arm64 \
  --dmg /absolute/path/Catalyst-Foundry-VERSION-mac-arm64.dmg \
  --evidence /absolute/new/path/foundry-native-qa
```

This copies the app from a read-only mounted DMG into the new QA directory, checks trust and vendor integrity, and launches only app-owned isolated smoke mode twice. It retains `launch-save.json`, `launch-reopen.json`, logs, exit codes, launch times, project identity and `verification-summary.json`. It never opens the user's normal profile. A 180-second timeout fails that Mac check; a delayed later observation must be recorded separately, not relabeled as a passing first attempt. These checks do not prove GPU rendering or real CAD import.

Run the portable native fixture controller with the packaged runtime:

```sh
export FOUNDRY_QA_RUNTIME='/absolute/path/installed/Catalyst Foundry.app/Contents/Resources/slicer'
export FOUNDRY_QA_WORK='/absolute/new/path/native-slice-work'
node --import tsx scripts/windows/verify-review-connect.ts /absolute/new/path/native-slice-evidence
```

The historical script directory name does not make the code Windows-specific. It exercises six actual X1/X2D public-fixture slices, holes/normal/tree support, selected colors/settings, root-owned Review attachment/recovery, fixture-only approval, persistence and stale-on-edit. It does not contact printers, call Onshape or operate Connect. Retain output hashes, profile/runtime hashes, native logs and exact command/exit outcomes. Fixtures must remain non-manufacturable.

Only then perform authorized operator checks of normal installation to `~/Applications/Catalyst Foundry.app`, two normal launches, project save/reopen/export, file pickers/downloads, window sizing, camera, actual GPU rendering and observed CPU/RSS/FPS under representative public fixtures. Check Keychain-backed sign-in, shared cached parts/offline reopen and reservation behavior separately. Test target printer/AMS/physical manufacturing only with separate printer authorization; do not infer it from software fixtures. Preserve existing `~/Library/Application Support/Catalyst Foundry/` data across replacement/uninstall.

## Performance scope

The Windows release had one roughly 130-second first post-update startup. A later observation of the same app succeeded after the initial 90-second observer failed. That unresolved observation is retained; this local preparation does not claim to have fixed it in an installed app.

Local measurements identified repeated full runtime verification, whole-file buffer peaks and synchronous hash work. The prepared change enumerates the runtime once per check, reads every byte through four reusable 256 KiB buffers, and omits a redundant second verification within the same service-opening call. It has no persistent verification cache; profile selection, external configuration and each slice continue to verify. See the local preparation performance report for measured before/after CPU, memory, event-loop and worker results. No new app/GPU or low-end Mac performance has been measured.

## Hosted qualification findings (2026-10-20 UTC)

Native Apple Silicon and Intel jobs were authorized and executed. The pinned vendor has an empty CFBundleVersion and identifies 02.08.02.61 in CFBundleShortVersionString. Its code signature verifies, but Gatekeeper can reject it as Unnotarized Developer ID. Explicit unsigned QA can retain that failed trust result and continue compatibility tests; normal signed builds still require successful vendor assessment. No security settings, quarantine attributes or Apple credentials are changed.

Apple Silicon completed one genuine native public two-hole fixture slice, including exact demonstration review/save/reopen. The next verification detected an added vendor Resources/result.json. Complete repeated slicing and packages remain unqualified until that writable-output defect is corrected and both architectures pass. This is a failed integrity check retained as evidence, not an exception to the inventory policy. No Mac installer is presented as built or validated on the basis of Windows tests.
