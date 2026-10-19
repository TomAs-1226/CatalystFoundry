# Architecture

## Boundaries

- `src/App.tsx`: guided Select design / Prepare / Slice & inspect / Approve / Export navigation. Queue and Setup are secondary actions. It owns project state, explicit mutations and a single async commit guard.
- `src/components/LiveOnshapeIntake.tsx`, `SourceDialog.tsx`: progressive live CAD selection and dimension confirmation; fixtures/local STL are explicit separate tabs. `source-configuration.ts` preserves configuration encoding and rejects ambiguous edits.
- `src/components/WorkspaceViewer.tsx`, `camera-frame.ts`, `viewer-geometry.ts`: real meshes, conservative copy layout, installed-vs-manufacturing transforms, exact projected fit, orbit/pan/zoom and actual parsed toolpaths.
- `src/components/SlicingPanel.tsx`: host configuration, explicit profile selection, exact geometry preparation, job progress/logs/cancellation and reopenable status. It never chooses a printer silently or dispatches to one.
- `src/domain/*`: immutable-source records, geometry integrity, manufacturing manifests, exact approval/review/release state, preparation suggestions/checks and validated persistence. No browser, account or machine dependency is required for domain tests.
- `src/adapters/onshape.ts`: strict link parsing, fixture adapter, repeated/nested occurrence resolution and documented Onshape calls. `onshape-http.ts` is the browser-safe same-origin adapter; credentials never cross it.
- `server/onshape-service.ts`, `onshape-http.ts`, `onshape.ts`: configured server-owned OAuth transport, narrow documented identifiers/routes, metadata and native dimension mapping, atomic background import/cancel/cache. Source data retains both linked part context and selected root assembly version/element/configuration. Live private account qualification and login/refresh remain outstanding.
- `src/adapters/toolpaths.ts`: bounded linear G-code interpretation with explicit units/modes/feature layers, unsupported-command warnings and approval blocking. Unsupported machine macros are not approximated into verified motion.
- `server/slicer.ts`, `slicing-config.ts`, `slicing-http.ts`: independent persisted worker, pinned executable/version/profiles, complete process resolution, exact transformed/copy geometry preparation, output hashing, cancellation/restart and native/final artifact preservation. No browser-supplied executable or arbitrary local path is accepted.
- `server/app.ts`: same-origin local HTTP API, actual atomic file-backed save/reopen, capability reports and adapter routes. `server/production.ts` is a cross-platform entry. Host environment configuration is read locally; no app credential store/provisioning is created.
- `electron/*`, `packaging/*`, `scripts/windows/*`: sandboxed Windows desktop host, loopback bundled service, per-user storage, NSIS build and isolated native install/two-launch verification. The Linux bundle smoke is not Windows validation.

## Exact manufacturing identity

The manifest binds source part and root-origin version/configuration, occurrence paths/transforms, original and normalized geometry hashes/dimensions/warnings, classification, quantities/spares, explicit units, per-copy rotation/placement, printer/model/nozzle/plate/volume, material mapping/qualification, supported process settings, slicer version/resolved profile bundle and reviewed use context.

A final approval additionally binds the final G-code hash, toolpath mapping and layer-review attestation, and native slicer project metadata/hash when present. Relevant mutations stale toolpaths and remove active approval. Unapplied category advice, navigation and CAD colour hints do not silently select filament or change process settings.

Async import/review/approval/export operations hash immutable snapshots and recheck live inputs before committing. Export commits a release record only after all artifact checksums are valid. Duplicate release/export uses the same release record. A fresh explicit slicing retry has a new attempt key; duplicate network submissions in that attempt remain idempotent. Revoking a mapping preserves original bytes/history and requires matching reattachment/review.

## Geometry and process artifacts

Original STL bytes, normalized geometry, prepared geometry-only 3MF, native slicer project and final G-code are distinct. Prepared 3MF contains explicit millimetre vertices for every reviewed copy/orientation/position; it is not represented as a machine/process project. The CLI requires complete separately resolved printer, filament and process profiles. The returned native 3MF is separately hashed and preserved, not synthesized and called sliced output.

Conservative source bounds support explainable orientation, volume/overlap and placement suggestions. They are not mesh contact analysis, support generation, load inference or FEA. Changes require explicit application, and geometry is never silently repaired or rescaled.

## Persistence and machine boundary

Project import/reopen validates normalized/original bytes, source units, exact manufacturing inputs, attestation and approvals. A newer valid browser draft can recover over an older disk save, including disconnected startup. The local service stores one active workspace; portable copies are the archival/transfer path. There is no authenticated multi-user conflict service.

Assignment/export never implies machine acceptance. Physical printing/completed states require explicit identified operator transitions and qualified data; this UI performs export/assignment only. Machine, material, nozzle, plate and clear-bed checks remain operator attestations, not sensor observations. Fixture/untested-profile packages remain non-manufacturable. Bambu private cloud dispatch, laser machine integration and numerical Onshape simulation automation are not implemented.
