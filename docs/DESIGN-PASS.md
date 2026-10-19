# Catalyst Foundry · manufacturing workspace design pass

Continued in the existing cloud checkout on 2026-10-17. The application remains local; no account, credential, printer or repository connection was created.

## Interface

The application now behaves as an engineering workbench: a compact source part tree, a persistent and larger 3D canvas, a contextual Part / Process / Checks inspector, and a searchable manufacturing queue table. At smaller widths, explicit Viewport / Inspector tabs keep both tools usable without stacking a long settings form underneath the model. The part strip, action bar and navigation stay available.

Typography uses self-hosted DM Sans with a small Space Grotesk brand mark. Spacing, borders, form controls, focus indicators, selected rows, disabled states and status labels share one restrained near-black/coral design system. Gradients, the marketing tagline, oversized project chrome and duplicate viewport headings were removed. Review/help content uses plain divided sections, rather than floating dashboard cards. Counts represent actual parts, copies, issues and jobs; no decorative metrics were added.

## Defects fixed before the design was finalized

- **Camera fit:** an axis-size estimate could misframe oblique/long objects and did not refit for a narrow viewport. The camera now checks all projected bounds corners against the usable area after toolbar/header/footer insets. It preserves viewing angle, target/pan and relative zoom across resizing; fit remains available explicitly. StrictMode initialization, empty bounds, axis poles and installed metre/mm transforms have regressions.
- **Async approvals and exports:** reading mutable objects between awaited hashes could let an input or mapping change during an operation produce a stale result. Import, review, approval, release and export now work from immutable snapshots and reject changed live inputs before commit. An interrupted/revoked export leaves no false release record.
- **Revoked mappings and reviewer changes:** explicit mapping revocation preserves the original artifact and history, clears active approval and layer-review attestation, and requires a new matching attachment/review. Corrected mapping, malformed persisted review dates, changed reviewer and duplicate actions are covered. Review checkboxes also reset when mapping, artifact identity or stale state changes, even if G-code bytes are unchanged.
- **Shared source records:** source byte/unit/attestation changes invalidate all affected jobs, including inactive jobs. Exact duplicate occurrence paths block approval; repeated names at distinct assembly paths remain valid quantities.
- **Preparation status:** batches with blocking geometry, quantity, source or process errors now show `needs review`; resolving those errors restores `ready to slice`. Missing downstream toolpaths do not prevent preparing a batch. Persisted incorrect readiness claims are downgraded on reopen. The existing approval/attachment guards continue to block invalid jobs.
- **Persistence:** preserved original bytes, normalized mesh, exact manufacturing inputs, toolpath attestation and approvals are independently checked on reopen. A newer unsaved browser draft takes priority over an older saved project; a disconnected project service can recover a validated draft with an explicit warning.

## Useful intelligence and controls

- **Orientation alternatives** show conservative rotated source bounds, all-copy empty-plate fit, height and layer/interface/support/tolerance trade-offs. Their explanations disclose assumptions. These are bounding-box heuristics, not contact analysis or simulation. No load, weak point, safety factor, support quantity, time or material consumption is fabricated.
- **Build-volume proposals** check every required copy and spare against the selected volume and other parts' conservative bounds. They preserve the manual orientation when possible, show proposed coordinates and rotation, and apply only when the user explicitly chooses. The existing geometry is never repaired or rescaled.
- **Part/profile recommendations** expose editable category, rationale and assumptions tied to printer/nozzle/plate/material. Applying a base recommendation retains manual overrides. Saving a team preset and resetting overrides use reviewable in-app dialogs. Untested examples remain labelled.
- **Quantity reconciliation** distinguishes CAD occurrence demand, required batch quantity, spares and total. Partial batches remain permitted manual overrides. Reconciliation explicitly updates the required quantity and preserves the spare count.
- **Preflight navigation** identifies the part and opens the relevant Part, Process, Toolpath or Review control. Examples include out-of-volume placement, overlapping bounds, invalid layer height, unavailable source, unknown classification and stale/revoked toolpaths. Warnings disclose assumptions, including the example nozzle/layer-height heuristic, and retain manual settings.
- **Revision warnings** compare the active job's pinned source against a newer fixture version, showing changed source and geometry hashes. Accepting a revision creates a separate job with no toolpath or approval; previous jobs keep their geometry and history.
- **Queue** uses real workflow state, material/printer/nozzle, quantities/spares, operator assignment and export records. Search and status filtering have empty states. Assignment does not imply printer acceptance or activity.

## Before / after and actual workflow evidence

Screenshots are actual Chromium/WebGL renders. Before/after comparisons use the same default fixture state (four source types, eight planned copies) at matching widths.

| View | Before | After |
| --- | --- | --- |
| Desktop · 1512 × 1000 | [Before](design-pass/before-desktop.png) | [After](design-pass/after-desktop.png) |
| Smaller desktop · 1024 × 800 | [Before](design-pass/before-tablet.png) | [After](design-pass/after-tablet.png) |
| Mobile · 390 × 844 | [Before](design-pass/before-mobile.png) | [After](design-pass/after-mobile.png) |
| Manufacturing queue | [Before](design-pass/before-queue.png) | [After](design-pass/after-queue.png) |

The recorded workflow and step images are generated from the actual fixture-selection → preparation → G-code inspection → approval → export → save/reopen browser test. The downloadable demonstration package has its full manifest and every exported file checksum checked by the test. It is explicitly **NON-MANUFACTURABLE**.

## What is connected and what is simulated

| Capability | Actual status |
| --- | --- |
| Onshape | Live access unavailable. Selection, versions, configurations, linked/suppressed handling and async geometry transfer are demonstrated through labelled fixtures. HTTP/auth boundaries use API-shaped test transports; no authorised live document was read. |
| Geometry | Actual ASCII/binary STL parsing, explicit mm/in conversion, exact original preservation and real mesh rendering. Fixture meshes are locally authored demonstration geometry. |
| Slicing | Real Bambu Studio execution unavailable. The pinned CLI worker is exercised with injected runners, and its subprocess behavior is tested with real local Node processes. No Bambu profiles have been physically validated. |
| Toolpaths | Actual supported linear G-code is parsed/rendered by layer and feature. The demo file is manually authored and was not sliced from the selected CAD. External file mapping remains an operator attestation. |
| Approval/export/persistence | Real SHA-256, exact manifest and attestation checks, deterministic ZIP packaging, local HTTP/file persistence and reopen validation. Reviewer identities are local/self-reported, not authenticated signatures. |
| Machine feedback | None. No printer was contacted or operated. Assignment/export never imply machine acceptance. |
| Simulation/strength | No numerical study integration, FEA, calculated weak points, stress maps or strength guarantees. Team-reviewed context and study references are manually entered. |
| Laser | Deferred until a machine and verified process-specific rules are selected. |

See [Onshape setup](ONSHAPE.md) and [slicer/profile qualification](SLICING.md) for the remaining integration work. See the final command/results section below for verification of this revision.

Additional evidence: [expanded orientation assumptions](design-pass/after-intelligence.png) and [preflight with quantity reconciliation](design-pass/after-preflight.png). Reproduce current guided UI companion captures (written under docs/guided-workflow) with `npx tsx scripts/capture-design-evidence.ts` while the local app is running.


## Final commands and results

- `npm run typecheck`: passed, exit 0.
- `npm test`: **176 tests in 14 files passed**, exit 0, **6.18 s**.
- `npm run build`: passed, exit 0, Vite **3.98 s**.
- `npm run test:e2e`: **6 Chromium cases passed**, zero failures, skips or flakes, **163.565 s**. This includes the complete workflow and the real overlap → needs review → explicit placement → ready to slice regression.
- `npx tsx scripts/smoke-production.ts`: passed against the actual built application/API with no API mocks; WebGL2, inspector/source controls, 390 px layout and zero page errors.

[Watch the actual 52.52-second workflow recording](design-pass/complete-workflow.webm), inspect the [approved demonstration package](design-pass/demonstration-approved-package.zip), or reopen the [portable project](design-pass/demonstration-project.catalyst.json). The package remains explicitly **NON-MANUFACTURABLE**: the manually authored demonstration G-code was not sliced from the fixture CAD.

[Full verification report](VERIFICATION.md) includes exact per-case durations, test coverage, remaining limits and machine-readable browser results. No remaining reproduced blocker was observed in the tested bounded workflow. The large JavaScript bundle remains a performance advisory; live Onshape, real Bambu slicing and physical machine qualification remain unavailable.
