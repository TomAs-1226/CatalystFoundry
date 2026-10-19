# Foundry: guided Onshape-to-manufacturing workflow

This revision continues the existing cloud checkout and replaces the complicated first screen with a deliberate five-step path. The [Sites design skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md) informed primary-task hierarchy, progressive disclosure, coherent branding and responsive controls. The work remains local-only under the user's explicit boundary; no Site was registered or published.

## The normal path

1. **Select design:** empty first launch; live Onshape is the primary intake mode. A paste/search flow resolves only documented identifiers, then requires immutable version, source element and configuration. Explicit part classification, CAD copy demand/spares and dimension confirmation precede import. Fixtures and local STL are separate choices, never automatic live-looking data.
2. **Prepare:** compact source tree and large usable 3D view. Part quantities and selected machine/material are the ordinary controls. Manual coordinates/rotation, detailed slicing settings, assumptions and logs stay collapsed. Geometric orientation/placement proposals apply only on an explicit action. Checks reconcile quantities and open/focus errors at the affected control, including controls hidden in details.
3. **Slice & inspect:** a real HTTP worker path prepares an explicit-mm 3MF from exact transformed mesh vertices and copies. Users explicitly apply configured printer/material/profile identity before slicing. The independent pinned CLI exposes progress, logs, cancellation and reopenable state. New manual attempts can retry failures; duplicate requests within an attempt remain idempotent. Stale or unsupported results cannot attach. Supported actual G-code is inspected by layer/feature/travel; no model cross-section is substituted.
4. **Approve:** exact-manifest summary, identified reviewer and explicit layer/manifest confirmations. Input or mapping changes revoke the active approval, including source origin context, normalized/original geometry, units, per-copy quantities/transforms, machine/material qualification, complete profile/settings identity and native/final artifact hashes. Async operations reject changed live inputs before commit.
5. **Export:** a separate step preserves operator checks and produces a versioned checksummed package. Assignment does not claim acceptance/printing. Demonstrations and unqualified profiles remain non-manufacturable. Save/reopen and portable import/export preserve the exact source and review history.

The queue and setup are secondary named header actions. Desktop and smaller-window interactions are checked in actual Chromium/WebGL. No fake metrics, decorative gradients or unrelated dashboard cards were added.

## Real integration work and remaining setup

**Onshape:** the runtime now connects the live browser flow to a narrow server API, documented v17 calls, immutable version/configuration metadata mapping, native dimension validation, source occurrence paths/transforms, background transfer/cancellation/cache and actionable permission/authentication errors. Credentials stay in a server-only token file. An authorised administrator must separately perform OAuth setup/login and manage token expiry; Foundry does not create credentials or implement a login/refresh flow. No private live account has been used here. API-shaped upstream tests are not live account qualification. Live automatic revision comparison remains deferred; fixture revision comparison is explicit and separate. See [ONSHAPE.md](ONSHAPE.md).

**Slicing:** the configured service path no longer stops at an unconditional 503 stub. It validates complete resolved machine/filament/process profiles, explicit printer/nozzle/plate/material, executable/profile hashes and supported settings. Geometry and settings are distinct from a native slicer project and final toolpath. The actual Bambu binary was separately exercised in this cloud environment; its generated startup/proprietary commands may require native review and remain blocked from Foundry approval. See the [actual slicing evidence](guided-workflow/actual-slicing/actual-slicing-report.json) and [SLICING.md](SLICING.md). The ordinary demo app remains disconnected until the host operator configures those local files. No Bambu account or printer connection is required for offline slicing.

**Windows:** Electron bundles the UI and local service, binds a private loopback port, uses per-user storage and keeps renderer Node APIs disabled. NSIS packaging and native installation/two-launch verification scripts are included. Linux bundle tests are not Windows validation. No EXE is represented as built, installed or launched here; native ROG validation is outstanding. See [WINDOWS.md](WINDOWS.md) and [ROG_AGENT_HANDOFF.md](ROG_AGENT_HANDOFF.md).

**Strength/safety:** geometric bounds and category heuristics cannot establish loads, weak points, material suitability or validated print strength. Suggestions expose assumptions and manual overrides. Reviewed study context is manual. Numerical Onshape simulation access, FEA, physical profile qualification, Bambu dispatch and machine-specific laser integration remain deferred.

## Evidence and acceptance

The [current verification report](GUIDED-VERIFICATION.md) records exact commands, final counts, complete browser/failure paths and artifact hashes. The [requirements audit](REQUIREMENTS-AUDIT.md) traces every original requirement to implementation/tests or a specific remaining gap.

Browser workflow recordings using fixtures/synthetic upstreams are separate from the actual binary-slicing experiment. Neither establishes that the selected CAD, complete Bambu startup program and physical printer profile have passed a private, production manufacturing run. No printers were operated.


## Actual rendered evidence

- [Guided first screen, desktop](guided-workflow/guided-start-desktop.png) and [mobile](guided-workflow/guided-start-mobile.png).
- [Preparation with advanced controls collapsed](guided-workflow/guided-prepare-desktop.png).
- [Complete fixture review/export/reopen recording](guided-workflow/complete-workflow.webm): identified fixture CAD and manually authored G-code, never production-ready.
- [Actual Bambu offline slicing recording](guided-workflow/actual-offline-slicing.webm): real binary on fixture geometry, native project generated, Foundry approval blocked for unsupported commands.
- [Actual browser slicing report](guided-workflow/actual-browser-slicing.json) and [downloaded native review project](guided-workflow/actual-browser-sliced-NON-MANUFACTURABLE.3mf).

Both recordings show software running in the cloud, not storyboard mockups. The actual CLI and fixture approval journeys have deliberately different qualification boundaries.
