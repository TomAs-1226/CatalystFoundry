> Historical shared-parts build report. The current automatic cloud-library installation is documented in Cloud-library-validation.md.

# Shared robot parts — Windows validation, 2026-10-18

The shared-parts update is installed in the normal per-user Foundry directory and reopened. The retained GitHub sign-in and server-side Onshape connection are confirmed through the normal local service. The website and authenticated Cloudflare Worker/D1 shared-CAD service are deployed. No private robot CAD was uploaded by this verification.

## Use it

1. Import the required robot parts once. Open Team sync & records, expand Share imported robot CAD, name the snapshot and keep the same robot work order. Review the displayed sharing audience and confirm permission, then publish. Only the imported selection is shared.
2. Other teammates sign in and open Team parts in the desktop source picker, choose the snapshot, search/select parts and add them to draft plates. They do not need to import that geometry from Onshape again or connect their own Onshape account.
3. On https://tomas-1226.github.io/CatalystFoundrySync/ teammates can download selected parts as a portable Foundry project. The website can also publish a portable project exported from Foundry. Reload the page once if it was already open during deployment.

Snapshots preserve immutable CAD IDs/version/configuration, original geometry bytes/units/hashes, quantities, occurrence transforms and subsystem memberships. A changed robot becomes a new snapshot; existing jobs are never silently replaced. Normal shared downloads use zero Onshape API calls. An initial import or an explicit newer-CAD refresh can require several Onshape calls; there is no promise of one call per robot or print. Existing work-order/source-copy reservations still guard duplicate manufacturing.

Jobs, toolpaths, machine profiles, approvals, physical checks, notes and manufacturing-status claims are excluded. Backup quantities start at zero. Fixture identity remains intact and non-manufacturable. Purchased/unavailable parts are excluded from print selection. Teammates still review their print setup and attest physical checks.

## Verified outcomes

| Check | Actual result |
|---|---|
| Native Windows build | Node 24.22.0; exit 0; 328 tests / 29 files passed |
| Standalone website/Worker | build exit 0; 37 tests / 5 files passed |
| Shared-CAD regressions | 7 tests passed, including exact bytes, quantities, corrupt data rejection, consent, team isolation, atomic bounded writes, owner deletion and no-Onshape-user downloads |
| Original desktop lockfile | unchanged: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973 |
| New NSIS install | verifier exit 0; unsigned (NotSigned) |
| Installed save/reopen | both real renderer launches exit 0 in isolated data; same saved project reopened; loopback/origin and renderer Node isolation passed |
| Installed content | 6248 bundled slicer files hash-checked, 12 catalog mappings, service/desktop/production UI match current source |
| Normal per-user update | installer exit 0; EXE, app.asar and runtime manifest match verified build; 2 shortcuts checked; app reopened |
| Retained connections | GitHub TomAs-1226 signed in; Onshape connected; bundled Bambu Studio 2.8.2.61 available |
| Authenticated production shared CAD | public non-manufacturable fixture published, listed, downloaded, decoded and removed through the normal installed service and real Cloudflare storage |
| Onshape requests during production probe | 0 before / 0 after; zero additional attempts |
| Fixture qualification | original geometry hash, dimensions and quantity 3 preserved; no approval/toolpath shared; no user project modification or printer contact |
| Website | HTTPS assets match tested local build; workflow https://github.com/TomAs-1226/CatalystFoundrySync/actions/runs/39153713895 succeeded |
| Worker / D1 | 1a0247ea-d67d-4680-acdf-900136bcd3a6; migration 0004 applied |
| Public repository | cb29ca1a05da450745a3e59ac98690f22f47d553; website assets unchanged from the verified Pages build |

The normal service reported 0 saved part types; saved project present: false. Save/export was confirmed by the user before closing. If no server project existed, portable exports remain the user's saved copy; this check did not inspect unrelated export files.

The first production fixture probe exposed a false deletion error: D1 counts cascaded chunk deletions in its total change count. The snapshot had been removed, but the old equality check returned 409. The deployed Worker now confirms the exact returned snapshot ID from an owner/team-scoped DELETE. The SQLite helper models total_changes semantics, all 328 integrated and 37 standalone tests pass again, and the real production probe passes. This Worker-only correction does not change the installed desktop binaries. See [Cloudflare's D1 change-count definition](https://developers.cloudflare.com/api/resources/d1/). A sandbox-only regression run was blocked from loopback HTTP (EACCES); the full authorized native rerun passed without changing tests.

## Audience and limits

The workspace currently admits any signed-in GitHub account, as requested. Those accounts can download explicitly shared CAD without Onshape document access. The uploader sees and must confirm this audience before publication. Credentials and Onshape grants are excluded. Only the uploader can delete a snapshot; previously downloaded copies remain.

GitHub Pages hosts static UI. Authenticated Cloudflare D1 stores CAD, preferences and manufacturing records. There are at most 20 snapshots per team, each bounded to 24 MiB expanded JSON, 6 MiB gzip and 512 KiB catalog metadata. Oversized robots must be split by subsystem. Chunked atomic writes and immutable IDs prevent partial catalog uploads and silent overwrites. No background document polling is required.

## Limits of verification

Live private/whole-robot CAD import, interactive desktop/website behavior, the complete Windows browser suite, actual GPU rendering and low-end laptop performance remain untested in this update. Foundry UI automation was not used, following the user's instruction. The current shared-CAD flow was checked through source/tests and normal installed service APIs. No printer was contacted or started, and no physical print quality or machine acceptance is claimed. Older native offline slicing reports in the evidence archive are dated historical results, separate from this update's installation checks.

Installer: Catalyst-Foundry-0.1.0-x64-Setup.exe

SHA-256: `061824c00d1ae4731df2b63341da1f08fdce624deeabc3115b7d689391312d80`

The shared-parts-named installer is an identical alias of this verified current installer. Exact native receipts and commands are in the evidence archive; original CAD, private project backups, account credentials and encrypted sign-in storage are excluded.
