> Historical cloud-library build report. The later desktop entry refinement is described in Start-here.md.

# Automatic cloud parts library — 2026-10-18

The current automatic-cloud-library version is installed and reopened in the normal per-user Foundry directory. GitHub/Onshape sign-in is retained and the bundled slicer is available.

The website is deployed at https://tomas-1226.github.io/CatalystFoundrySync/. The existing authenticated Cloudflare Worker/D1 is the cloud CAD store; no new R2 bucket/account/billing setup was provisioned. This update removes the separate sharing step for newly pulled Onshape CAD.

## Normal workflow

1. One teammate opens a saved robot/version in Onshape intake, selects Find robot parts, then Sync robot to team library. Available unique part types are fetched in bounded batches, with CAD copies/subsystems preserved. Purchased geometry can be listed but cannot become a print selection. Suppressed/unavailable parts are not invented as cached geometry.
2. Each successful geometry batch saves to a durable account-scoped local upload queue. Foundry uploads the exact bytes automatically. Pending/error status is visible; no separate project export or manual sharing is required. An interrupted cloud upload retries local bytes rather than reimporting Onshape. Initial CAD pulls still consume the guarded Onshape allowance.
3. Other desktops show all stored parts on the start page after GitHub sign-in, and automatically download/verify geometry serially. Search across robot names, parts, materials or subsystems, then add selected parts from one work order to draft plates. They need no Onshape account grant. The website lists the same catalog and offers portable projects.
4. Snapshots marked Saved on this laptop remain usable after disconnecting and restarting. A new laptop must finish its first download online. Shared manufacturing reservations still need the online service; offline cached geometry does not authorize duplicate physical print starts.

Native cache files live under per-user app data, independently of renderer localStorage and the ephemeral loopback port. They are keyed to the encrypted account session and service. Explicit sign-out/account/service changes prevent another session from reading or uploading the previous session’s cached CAD. Cached geometry is hash-checked again before use. Queued CAD is bounded and never reported as uploaded on capacity/network failure.

Cloud metadata/geometry refresh runs at startup, when Team parts opens, when the UI sees the network return, and every five minutes in the native service. The UI rereads its local catalog every 30 seconds while open; the website checks the cloud catalog once per minute. These requests do not call Onshape. There is no automatic crawl of every Onshape document or silent move to a newer CAD revision.

## Actual checks

| Check | Result |
|---|---|
| Windows build | exit 0; Node 24.22.0; 333 tests in 30 files passed; production UI/service bundled |
| Desktop lockfile | unchanged: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973 |
| Cache regressions | 5 passed: automatic publication/prefetch, restart/offline reads, interrupted upload retry, account isolation, corrupt cached geometry and full-cloud retention |
| Onshape completion hook | mocked upstream test confirms exact returned geometry reaches automatic save callback; no live CAD request |
| Website/service | 37 tests passed; production/type build exit 0 |
| Current packaged launches | save and reopen exit 0 in separate isolated profile; real renderer mounted, Node unavailable; loopback/origin checks passed |
| Real cloud acceptance | automatic upload, second isolated local cache prefetch, restart and offline read passed; injected offline transport on verifier only |
| Onshape counter | 0 before / 0 after; zero additional attempts |
| Test data | public fixture only; original hash/dimensions/quantity retained; remains non-manufacturable; no toolpath/approval/checks copied; exact test snapshot removed |
| Pages | workflow https://github.com/TomAs-1226/CatalystFoundrySync/actions/runs/39157964253 succeeded; published JS/CSS hashes match local build; HTML matches after Windows/Linux line-ending normalization |
| Public repo | 28a77e71564e09f6f0a11c17b91ad8827452b505 |
| Cloud backend | existing Worker 1a0247ea-d67d-4680-acdf-900136bcd3a6 and D1 migration 0004; no backend redeployment needed for native caching |
| New NSIS install and normal update | both exit 0; installed code/runtime hashes verified; two isolated installed launches passed; normal retained connections and slicer availability confirmed |
| Normal installed native cache | actual /api/library routes automatically prefetched a public fixture from production cloud storage, verified its local geometry and non-manufacturable identity, then removed it from cloud and current local catalog; zero additional Onshape attempts |

The production verifier used the actual authenticated normal desktop proxy and cloud storage with two isolated verifier cache directories. Offline behavior was simulated by blocking that verifier’s transport; machine networking/security settings were not changed. The separate cache tests use the real SQL schema with mocked provider boundaries. No private robot, user project, credentials, manufacturing records or printer was modified.

## Limits

Cloud storage is bounded: 20 team snapshots, each at most 24 MiB expanded JSON and 6 MiB gzip, with 512 KiB metadata. Initial Onshape batches are limited to 100 selected types and the existing 24 MiB geometry safety budget; very large robots may need smaller subsystem pulls. At most 20 local uploads wait for cloud availability/capacity. Errors stay explicit and preserve queued data; no unlimited API/storage claim or silent truncation is made. The future-call protective cap stays at 1000 attempts and is not automatically reset.

The current workspace admits any signed-in GitHub account, as requested. The Onshape pull screen discloses that automatic cloud copies are shared with that audience. Existing local projects/private files are not crawled or uploaded on startup. Existing approvals, toolpaths, profiles, quantities of backup production, notes and physical-check attestations are excluded from shared CAD. Newer CAD remains a new immutable snapshot; existing jobs are not silently replaced.

Live private/whole-robot intake, the complete interactive Windows browser suite, actual GPU rendering and low-end laptop performance remain untested. No Foundry UI automation was used. No printer was contacted or started and no physical print quality/acceptance is claimed. Earlier offline slicing/native installation reports are historical evidence with their own hashes.

Installed installer: Catalyst-Foundry-cloud-library-0.1.0-x64-Setup.exe

SHA-256: `d98ddd2c5cf1c6449bac764811b1cf9b57d7b08af7a4569fbd4e6f3b22a9a31e`

The regular output installer is the same current verified build.
