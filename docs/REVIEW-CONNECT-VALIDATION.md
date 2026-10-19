# Foundry Review recovery and Bambu Connect update

Foundry installed and restarted at its normal per-user location. Native NSIS installation, two isolated launches, installed-file integrity and the normal installed service passed.

Official Bambu Connect 2.5.0-beta.15 is installed per user and its empty application was opened for the user to sign in or pair a LAN printer. Native installer exit 0; executable signature Valid; protocol registration checked after first launch. The agent did not create an account, read credentials, log in, pair, discover or operate a printer. Foundry cannot observe Connect's login status.

## Use

1. Open Project → Connect a printer, or expand Printer connection and account next to native handoff on Review/Export. Existing official Connect is reused. Future Windows users can choose Install & open Bambu Connect; the included setup downloads the pinned official installer, checks bytes and publisher, installs per user and opens login/Discover. It does not embed the proprietary Connect binary, an account or a shared team password.
2. Cloud: use an existing operator/team Bambu account inside Connect. LAN-only: use Discover and the printer's pairing information inside Connect. Foundry's shared manufacturing records remain independent of that Bambu login.
3. Slice the actual plate and inspect its layers. Monitoring and exact attachment now continue when leaving the 3D workspace for Review. Review automatically recovers a matching saved slice and shows waiting, attachment and failure states. Retry native layer attachment or Find this plate's saved slice can recover interrupted delivery without another CAD pull. Changed or old geometry-preparation output still requires reslicing; a withdrawn mapping cannot silently return.
4. Confirm layers, manifest and the actual printer/nozzle/plate/filament/native routines before approval. Real CAD can use explicit setup confirmation; public fixtures and marked demonstration G-code remain non-manufacturable. In Connect, inspect the exact native file, loaded material, physical conditions and target before your own final Print action. Opening Connect is not proof of printer acceptance or printing.

## Corrected defects

The latest observed real local slice succeeded and passed the parser. Its native bounds were inside the bed. The remaining lifecycle gap was that workspace-local monitoring/restoration/attachment vanished when Review removed the workspace panel. The persistent root session now owns that work. Navigation no longer disposes it; it waits for busy actions, discards late results from other jobs, serializes overlapping results and verifies the exact toolpath actually exists/current in job state before announcing preview success. A no-op attachment cannot claim success. Review offers recovery directly instead of an inert return-to-slicing message.

The old Get Bambu Connect website URL returned 404. Setup now uses Bambu's current official wiki and its pinned Windows download. The official Connect executable does not register its protocol until first application launch; detection can find its publisher-verified program directly. Production verification also exposed PowerShell 7's inherited module search path preventing Windows PowerShell 5 from loading the signing cmdlet. The host now explicitly loads Windows PowerShell's own security module. Execution policy, certificate validation and machine security settings were not changed.

No Bambu passwords, access codes or team account are created/shared by this integration. Login state and printer state stay unknown to Foundry. The source supports cloud/LAN intent and exact native handoff, while Connect controls the actual mode, printer and final dispatch. Fixture, immutable-source, hash, profile, quantity/orientation, mapping/revocation and physical-release checks remain in force.

## Verified outcomes

- Native Windows x64 / Node 24.22.0 final build exit 0; typecheck and 397 tests in 44 files passed. Original lock SHA-256: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973.
- New lifecycle regressions cover Review recovery, panel removal during monitoring, busy/failed commits, late restoration, changed jobs, newer slices during slow attachment, stale inputs, revoked mappings, no-op attachment, corrupt artifacts and portable approval persistence.
- Six fresh real Bambu Studio 2.8.2.61 public fixture slices passed for X1/X2D holes and normal/tree required-plus-backup support cases. The root session polled and attached with no workspace panel, and exact fixture-only review/approval/save/reopen/invalidation passed. Advanced wall/shell/speed/support/brim/infill values and selected filament colors remain in native artifacts. Both bore cores remain open. The final session code replayed all six byte-verified artifacts as an additional recovery check. These are headless controller tests, not actual UI navigation.
- Official Connect installer SHA-256: 60008eeaf2ccafc4767c3e510fa3b79326633c905f17512ee6c7137dcb35bb8f. Installed executable SHA-256: 9772514303bc6ea5597bd6828e6a32075c9b51b94a7438a97f757e8a46742a93; Authenticode Valid, organization Shanghai Lunkuo Technology Co., Ltd. The installer hash was measured after official download and valid publisher verification; it is not presented as a separately published vendor checksum.
- Native production host detection passed against the actual installed Connect. Setup regressions reject unrelated/invalid publishers, altered installer bytes, non-vendor redirects, oversized downloads and renderer-supplied install URLs. Detection does not download or launch; an empty explicit launch has no file or printer argument. Setup API login/printer status remains unknown. No real print/handoff call was used in these checks.
- The actual production JavaScript downloader fetched all 118268104 bytes from the pinned official host and matched the expected SHA-256. This positive transport check ran no installer or printer operation; its one temporary check file was removed afterward.
- Packaged save/reopen/reduced-motion launches exited 0, with visible startup/animation completion checked. Desktop/service/companion module, production assets, three workers, all 6248 runtime files and 12 profile mappings match.
- Actual native NSIS installation/save/reopen and normal app launch passed. Existing GitHub/Onshape connection status and last printer selection were retained. A separate public fixture through the actual normal installed HTTP service sliced, recovered/attached from the root session, approved as demonstration-only, survived reopen and staled on edit. The installed companion setup API detected official Connect and exposed setup/open actions without starting it. The Onshape counter did not increase.

## Limits and retained failures

Foundry UI automation remains prohibited by the user. Actual button/navigation interaction, perceived appearance, complete browser suite, live printer/AMS/firmware compatibility, cloud/LAN acceptance, physical printing and physical qualification are UNTESTED. Software/native fixture checks do not establish zero defects or release readiness for real manufacturing. No printer start, credentials, security-setting change, repository push or publication was performed.

The first Connect registry probe returned wrapper exit 1 after installer exit 0, because registration occurs on first application launch; the subsequent empty launch and registration check passed. The first production detector returned unavailable because of the inherited PowerShell module path; the fixed real detector passed before packaging. An initial build passed 396 tests, then the native detector correction and an additional overlapping-slice regression were included in the final 397-test build. Earlier failures are retained as observations, not reused as successful checks. Connect setup/sign-in remains an operator step, and the agent has not inspected its account.

Installer: Catalyst-Foundry-review-connect-0.1.0-x64-Setup.exe

SHA-256: 6b7e0ab88b04ce1c51c0884ffa9d90cecfd920b0b873a6726817bc7bee75bc4d
