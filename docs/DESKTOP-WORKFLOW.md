# Foundry workflow and toolpath update

Installed and reopened in the normal Foundry app.

## Use it

1. Open Team parts and add the needed parts to draft plates. Existing cloud CAD remains reusable without another Onshape pull.
2. In Prepare, use **Printer & material**, review the exact included profile, and choose **Apply to this plate**. An already configured profile can be applied directly.
3. Resolve the visible **Before slicing** checks using their **Fix** buttons. **Print settings** opens the relevant settings. Manual profile overrides and example recommendations are collapsed.
4. Choose **Slice plate**, directly below the large 3D workspace. Foundry shows the existing plate while slicing; real layers appear when ready. There is no separate manual attachment step for a supported exact result.
5. **Update after edits** turns on after the first explicit slice. It waits one second after valid edits, refreshes the process profile hash, and queues one updated slice when the current slice finishes. Turn it off to control slicing manually. Cancel turns it off. Failed attempts wait for an explicit retry or a different valid manifest.
6. Scrub layers and toggle features to inspect actual moves. **Review in Bambu Connect** exposes native handoff; printer conditions and the final print remain operator actions. Approval and exports remain separate.

## Corrected defects

- Slicing controls were only inside a closed inspector; the controller now stays visible and mounted while switching between Prepare and Toolpaths.
- A transient status fetch error stopped polling permanently. Status requests now retry serially with bounded backoff and stop on completion/cancellation or disposal. Late results from a different job are discarded.
- Process edits changed the resolved profile hash but left the job with the old identity. Same-hardware process hashes now refresh automatically; printer/material changes require explicit profile selection.
- Successful results required another attachment click, and genuine output with unsupported machine commands left an empty view. Current results display automatically. Incomplete previews have a blocking banner, preserve command limitations, and cannot receive Foundry approval. A revoked mapping is never silently restored on recovery.
- Every slider/filter change scanned all segments and disposed/rebuilt GPU geometry and the bed. Feature buffers now build once; layer changes update draw ranges/visibility only. Parsing the layer preview runs in a cancellable worker, with job/result identity checks.
- Prepare counted missing downstream toolpath/review requirements as input failures. Its checks now show the errors needed before slicing. The mobile checks button also opens its drawer.

## Actual validation

- Native Windows x64 / Node 24.22.0: final Build-Installer.ps1 exit 0; typecheck and **346 tests in 33 files passed**. Original dependency lockfile unchanged.
- Executed the actual bundled preview worker in a Node worker test; parser results, unsupported-command blocking, errors and request identity match the production parser. This does not exercise browser Worker execution.
- Regression checks cover serial polling, disconnect/backoff recovery, cancellation/disposal, changed process profiles, exact-manifest binding, revoked mappings, duplicate approvals/exports and existing CAD/cloud boundaries.
- CPU-only synthetic measurement: 250000 segments / 1000 layers, 6.0 MB positions; index build 60.3 ms; 20000 range updates 13.7 ms. These are measurements on this Windows machine, not GPU or low-end-laptop frame rates.
- The unpacked package matches the compiled service and UI assets, includes the worker asset, and passes all 6248 runtime-file hashes plus 12 catalog mappings.
- Existing isolated packaged save/reopen checks both exit 0. They verify renderer startup/security and persistence; they do not validate interactive workflows, visual clipping or actual GPU rendering.
- Actual NSIS install, installed isolated save/reopen, installed code/asset checks, 6248 slicer-file hashes and 12 catalog profiles passed. Normal update exit 0; GitHub/Onshape connections retained and included Bambu slicing available. The normal service serves the exact production module and preview worker with JavaScript MIME types and allows the worker in its content-security policy.
- The compiled service is byte-identical to the previous installed version (b547b5320354140ba4be64c6739de5af3c51db9624bcc849b03ee3a73f8596f1); cloud endpoints and Onshape request policy are unchanged. No live Onshape geometry calls or printer operations were made during this update. Website deployment is unchanged.

## Limits and remaining checks

Foundry UI computer use and the interactive browser suite were not run under your instruction. Visual layout, browser Worker execution, GPU quality/frame rate, whole-robot private CAD intake and real printer acceptance remain untested. Unsupported Bambu commands still require full native review. Profiles remain physically unqualified; fixture CAD and demonstration G-code stay non-manufacturable. Background edits never approve or start printing. Source buffers have the existing 250,000-segment / 10 MiB parser bounds; larger output needs native review. Initial/new-revision Onshape imports still consume multiple API requests; cached reuse and local slicing do not.

Installer: Catalyst-Foundry-workflow-0.1.0-x64-Setup.exe

SHA-256: 4e8a0f8a5842bef33c8f8d2ac1d14e04148b78030740827320feb775c95bdd1d
