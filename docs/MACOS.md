# Mac 0.2.4 test candidates

Apple Silicon and Intel packages passed native build, isolated installation and save/reopen checks on GitHub-hosted macOS 15 runners. Each architecture also completed six genuine offline Bambu fixture slices. **Foundry itself is unsigned and not notarized. These are QA candidates, not trusted Mac distribution packages.** No personal Mac, Apple account, signing identity or security settings were used or changed.

## Downloads and evidence

The [successful native run](https://github.com/TomAs-1226/CatalystFoundry/actions/runs/39370796285) used clean source `8dd8ca09cb9aa61403f2f396592138f95fc147ca`, Node 24.22.0, Electron 42 and Bambu Studio 2.8.2.61. The immutable Windows 0.2.4 release has its own earlier source revision and evidence.

| Target | DMG and ZIP | Native checks |
| --- | --- | --- |
| Apple Silicon `arm64` | [QA artifact](https://github.com/TomAs-1226/CatalystFoundry/actions/runs/39370796285/artifacts/12240969896) | Build; installed app save/reopen; six native slices passed |
| Intel `x64` | [QA artifact](https://github.com/TomAs-1226/CatalystFoundry/actions/runs/39370796285/artifacts/12241532918) | Build; installed app save/reopen; six native slices passed |

Artifacts can require GitHub sign-in and expire under the repository's artifact retention policy. Retain the matching `package-build.json`. It is written **before** installation and slicing: its `nativeLaunchVerified: false` and `slicingVerified: false` describe that earlier stage. Later passing steps and six case results are in the linked run logs; the original build report has not been rewritten. Detailed temporary Mac launch/slice JSON files were not uploaded by that run. The local validation archive retains both job logs and downloaded packages; exact per-case Mac toolpath hashes are not claimed from missing reports.

SHA-256 values, independently checked after downloading both architectures:

```text
758a0a381bbbc52c134c3bbcfa20d7345fe1ab6f75fc01419179f3176ce1c22d  Catalyst-Foundry-0.2.4-mac-arm64.dmg
1894a0ebeb98b5cacf44be248e19e11ab22b8792809d7d55b5cef29c6ac67965  Catalyst-Foundry-0.2.4-mac-arm64.zip
194c797d195b07a2278e1a5213078d99e8334ee7d5bab46e96cf4f73c21a02a5  Catalyst-Foundry-0.2.4-mac-x64.dmg
5ffc5ce1fcb2d1af441302202466cf08404b44a74dc98c8768083e0703f7494e  Catalyst-Foundry-0.2.4-mac-x64.zip
```

Both jobs passed 429 tests with two platform skips across 51 files. The DMG verifier mounted the real image read-only, copied the app into an isolated QA directory, checked every packaged vendor byte and its preserved signature, then launched that packaged app twice against a new profile. The same saved project identity survived reopening. Six X1/X2D holes/normal/tree cases ran separately against the prepared native vendor tree; the packaged copy was checked against that complete pinned inventory. Cases cover root-owned toolpath attachment, fixture-only approval, persistence and stale-on-edit. They did not contact Onshape, Connect or printers and do not qualify a physical profile.

## What remains to qualify

Hosted checks do not establish normal-user GPU performance, minimum-macOS compatibility, Keychain-backed sign-in, file pickers, multi-device record sync on a Mac, AMS/printer compatibility or physical print quality. Representative operator testing remains necessary. The configuration floor is macOS 13.5; testing occurred on macOS 15. No Universal/Rosetta package is qualified.

Mac uses per-user Application Support storage and Electron secure storage. Sign in afresh; Windows encrypted sessions are not portable. The app shares the website's team library and records implementation, but its normal account workflow needs Mac operator validation. Reusing an immutable cloud part does not require a fresh Onshape geometry download. Offline preparation does not reserve manufacturing copies.

Windows NSIS OTA, automatic Connect installation and direct Connect handoff are disabled on Mac. Mac OTA is not implemented. Native `.gcode.3mf` export is available for operator-controlled review in a separately installed vendor application; that end-to-end handoff is unqualified. Export never starts printing.

## Pinned slicing runtime

The complete official Bambu Studio 2.8.2.61 application, frameworks, resources and profiles are included. A separate Studio installation or account is unnecessary for the bundled offline CLI.

- [Official DMG](https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/Bambu_Studio_mac-v02.08.02.61-20260820225108.dmg), SHA-256 `cf648a95858fb630e1353c4987038df60d6caab693f18411fb95fb809f2d6926`.
- [Corresponding source](https://codeload.github.com/bambulab/BambuStudio/tar.gz/refs/tags/v02.08.02.61), SHA-256 `fccea7043da48dfd05b98fdfc341cb29d0169880f3b3ae6bedf00ebfd3be7d28`. Matching source, license and upstream notices accompany packaging.

Preparation verifies hashes, mounts read-only, checks vendor signatures and inspects every Mach-O architecture. The vendor's short version identifies `02.08.02.61`; its `CFBundleVersion` is empty. Both final jobs recorded `vendorGatekeeperAccepted: true`. That assessment applies to upstream Bambu, not the unsigned Foundry wrapper.

Every vendor file and internal relative symlink is inventoried. Missing, changed, additional or escaping entries fail verification. Resolved profiles and native outputs stay outside the vendor app. An earlier native trial sliced once, then correctly failed because Bambu wrote `Resources/result.json`. Mac invocation now supplies an external `--outputdir` and an export basename, matching pinned vendor path behavior. Both final runs completed six repeated slices without changing the vendor tree. No inventory exception or security bypass was added.

## Reproduce native QA

Build each architecture on matching native hardware with Node 24.22.0 and Xcode Command Line Tools. Use a clean checkout and retain the lockfile. Supply the two pinned upstream files:

```sh
npm ci
npm run dist:mac -- --arch arm64 \
  --bambu-dmg /absolute/path/bambu.dmg \
  --bambu-source /absolute/path/bambu-source.tar.gz \
  --unsigned-local
node scripts/macos/verify-installer.mjs --arch arm64 \
  --dmg release/mac-arm64/Catalyst-Foundry-0.2.4-mac-arm64.dmg \
  --evidence /absolute/new/path/foundry-native-qa --unsigned-local
```

Use `x64` and native Intel Node for Intel QA. Explicit unsigned mode permits compatibility testing; it does not establish distribution trust. Do not alter Gatekeeper, quarantine attributes or organization policies to make a candidate run.

Run fixtures against the installed package runtime when retaining a complete final acceptance report:

```sh
export FOUNDRY_QA_RUNTIME='/absolute/path/installed/Catalyst Foundry.app/Contents/Resources/slicer'
export FOUNDRY_QA_WORK='/absolute/new/path/native-slice-work'
node --import tsx scripts/windows/verify-review-connect.ts /absolute/new/path/native-slice-evidence
```

The historical script directory does not make it Windows-specific. Keep `launch-save.json`, `launch-reopen.json`, `verification-summary.json`, case reports, toolpath/profile hashes and command outcomes. Fixtures must remain non-manufacturable.

## Signing and notarization

Normal Mac distribution requires an authorized Developer ID Application identity and notarization credentials. Neither was supplied or created. A Windows OTA signature does not substitute for Apple signing. Preserve vendor signatures and verify the complete runtime after signing the wrapper. Submit the signed DMG to Apple, require acceptance, staple/validate it, and regenerate the ZIP from the stapled app. Retain final hashes after these byte-changing steps and repeat native checks on those final artifacts. No notarization upload was performed here.

Preserve `~/Library/Application Support/Catalyst Foundry/` during replacement. Manual installation, two normal launches, portable-project save/reopen, file pickers, camera/GPU behavior and team sign-in/offline recovery remain operator acceptance steps before broader Mac rollout.
