# Desktop updates

Project → App updates checks the public CatalystFoundry GitHub release feed. Windows x64 internal builds check at most once per six hours after startup and download newer verified releases in the background. Manual Check for updates is available. No Onshape requests are involved.

The renderer cannot choose an executable, update URL, command arguments or a verification key. The native host checks a strict Ed25519-signed manifest, release repository/path, platform, architecture, version, byte limit, declared length and SHA-256. It rejects altered manifests/installers and older versions. It checks cached bytes again before installation. Only the public key is in the app; the private release key is protected locally with Windows DPAPI and can be supplied to the release workflow as a repository Actions secret.

Save & restart first waits for an exact local project save. Active slicing blocks installation. A separate bundled Windows helper waits for Foundry to close, checks the downloaded file again, runs the existing per-user NSIS installer, retains app data and restarts the installed application only after installer exit 0. No reboot, elevation, printer action or security-setting change is requested. The first update to an old 0.1.0 app still needs a normal installer because that build contains no update client.

This is a Foundry NSIS update protocol, not Squirrel or Electron's built-in autoUpdater feed. The Windows EXE currently remains unsigned with Authenticode; the Ed25519 release manifest authenticates OTA bytes and does not replace Windows publisher signing or remove SmartScreen behavior.

## Release

1. Change the package version using `npm version <version> --no-git-tag-version`; retain the existing lockfile.
2. Run `scripts/windows/Build-Installer.ps1`, then native Verify-Installer save/reopen checks on Windows. Keep the exact build, slice, install and launch reports. Manual UI/GPU/printer checks are separate.
3. Sign the exact installer using `node scripts/windows/sign-update.mjs release/Catalyst-Foundry-<version>-x64-Setup.exe` with FOUNDRY_UPDATE_PRIVATE_KEY set, or use `--protected-key <absolute DPAPI file>` on its owning Windows account. The signer checks its public-key match before writing `foundry-update.json`.
4. Publish the installer, `.sha256` and `foundry-update.json` together on tag `v<version>` as an internal prerelease. Never publish a private key, credentials, machine access code or CAD records.

The Windows workflow performs build and native checks on pushes and PRs. It publishes only on an explicit workflow dispatch with Publish enabled. Its manifest signing secret is never printed or placed in artifacts. Replacing the verification key would break trust for existing installations; preserve the protected key and Actions secret.

Electron's [update documentation](https://www.electronjs.org/docs/latest/tutorial/updates) describes release metadata and explicit restart patterns. Foundry keeps the current NSIS packaging and uses the protocol above.
