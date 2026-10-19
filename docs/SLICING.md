# Offline Bambu slicing and operator handoff

Current source behavior: see [Process controls and native approval](PROCESS-APPROVAL.md) for the bundled Windows runtime, 261 native process controls, exact-archive layer preview and explicit operator setup confirmation. The historical cloud experiment and parser limitations below describe the earlier baseline; use the delivered Windows validation report for current build/install evidence.

Foundry now has a configurable **real offline slicing path**, separate from the UI. The offline worker does not dispatch to printers. The Windows desktop can separately hand a validated native file to Bambu Connect for final review and printing; see [PRINTING.md](PRINTING.md). The default running service has no configured slicer and reports this explicitly. A public Bambu Studio binary was also executed successfully in this cloud environment; that smoke used fixture CAD and untested example profiles and is **NON-MANUFACTURABLE**.

## What genuinely ran

The public release API and [CLI manual](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage) were checked again on 2026-10-17 (Pacific). The pinned release is **2.8.2.61**, upstream tag [`v02.08.02.61`](https://github.com/bambulab/BambuStudio/releases/tag/v02.08.02.61). The documented CLI accepts full machine/process JSON with `--load-settings`, full filament JSON with `--load-filaments`, STL/3MF inputs, `--arrange 0`, `--slice 0`, `--export-3mf`, `--datadir`, and a selected `--curr-bed-type`. A geometry-only 3MF does not supply missing profiles.

The actual Linux experiment downloaded the Ubuntu 24.04 AppImage, verified its GitHub asset SHA-256, extracted it without installing a system application, and executed the extracted `bin/bambu-studio`. Initial execution failed because WebKit libraries were absent. Public Debian dependencies were extracted under `/tmp` and selected through `LD_LIBRARY_PATH`; no OS/security settings changed. `AppRun` resets that variable, so the raw executable was used. `--help` identified `BambuStudio-02.08.02.61` and the required flags.

A direct origin STL was rejected by Bambu's own exclusion-area validation; that error was retained. The subsequent smoke prepared three explicit-mm 3MF instances (two required plus one spare), with a manually selected 90° X rotation and valid explicit placements. The **real subprocess** produced native sliced 3MF and G-code. Native project settings were inspected for the requested layer height, walls, infill, supports, brim, speed and plate. Machine-specific macros and unsupported motion keep Foundry approval blocked; successful offline slicing is not physical validation.

Evidence is in [actual-slicing-report.json](guided-workflow/actual-slicing/actual-slicing-report.json), [runtime-evidence.json](guided-workflow/actual-slicing/runtime-evidence.json), and [bounded job logs](guided-workflow/actual-slicing/slicing-job.json). Native/project/toolpath files beside those reports are named **NON-MANUFACTURABLE**. No Onshape account, Bambu account or printer was used. A complete source-to-production workflow with a real Onshape account and qualified printer remains untested.

## Configure a worker on Windows or Linux

Offline slicing requires **no Bambu login**. Install the exact pinned Bambu Studio release on the authorized host and verify the upstream installer/archive digest. The executable itself is pinned separately; an installer/AppImage digest is not the executable digest. Windows must be validated on the ROG host, including native installer launch and actual Bambu dependency behavior.

Choose the team's actual model, nozzle, plate and filament. Supply complete machine, process and filament JSON configurations from the exact release. Small inherited files in `resources/profiles/BBL` are insufficient. Current profiles can contain both `inherits` and `include` templates for machine scripts: resolving only inheritance silently loses model-specific start/end code.

An offline helper resolves data from **one explicit vendor/release tree**, detects missing/ambiguous/cyclic references, merges parent and include templates and rejects remaining inheritance:

```powershell
npx tsx scripts/resolve-bambu-profile.ts "C:\Program Files\Bambu Studio\resources\profiles\BBL" machine "EXACT MACHINE PROFILE NAME" "C:\FoundryProfiles\machine.json"
npx tsx scripts/resolve-bambu-profile.ts "C:\Program Files\Bambu Studio\resources\profiles\BBL" filament "EXACT FILAMENT PROFILE NAME" "C:\FoundryProfiles\filament.json"
npx tsx scripts/resolve-bambu-profile.ts "C:\Program Files\Bambu Studio\resources\profiles\BBL" process "EXACT PROCESS PROFILE NAME" "C:\FoundryProfiles\process.json"
Get-FileHash "C:\Program Files\Bambu Studio\bambu-studio.exe" -Algorithm SHA256
```

Use the actual install/resource locations; they may differ. Review resolved configurations, model-specific start/end scripts, compatibility, temperatures, filament limits, exclusion areas and plate together. Structural key checks and hashes cannot establish full physical compatibility. Use lowercase hexadecimal digests in configuration.

Create a local JSON file matching this shape. All paths are absolute. Values below illustrate structure and are **not a selected/qualified team machine**; replace them deliberately:

```json
{
  "executable": "C:\\Program Files\\Bambu Studio\\bambu-studio.exe",
  "executableSha256": "REPLACE_WITH_64_LOWERCASE_HEX_DIGEST",
  "version": "2.8.2.61",
  "machine": {"path":"C:\\FoundryProfiles\\machine.json","sha256":"REPLACE"},
  "filament": {"path":"C:\\FoundryProfiles\\filament.json","sha256":"REPLACE"},
  "process": {"path":"C:\\FoundryProfiles\\process.json","sha256":"REPLACE"},
  "completeProfilesReviewed": true,
  "workRoot": "C:\\FoundryWork\\slicing",
  "profileLabel": "UNTESTED: explicitly selected model/nozzle/material/plate",
  "printer": {
    "id":"team-selected-machine", "model":"EXACT printer_model from machine JSON",
    "nozzleDiameter":0.4, "plate":"Textured PEI Plate",
    "buildVolume":[256,256,250], "tested":false
  },
  "material": {
    "id":"team-selected-filament", "name":"Explicit filament selection",
    "type":"PLA", "color":"#ed826f", "tested":false
  }
}
```

Model, nozzle, rectangular build volume and filament type must match the actual complete files. Only release-verified literal Bambu bed types are accepted (`Cool Plate`, `Engineering Plate`, `High Temp Plate`, `Textured PEI Plate`, `Supertack Plate`, as defined in the pinned release's `src/libslic3r/PrintConfig.cpp`); generic plate labels are rejected. This release keeps configured printer/material `tested:false`: a physical qualification record/workflow is still required before production claims. Do not change that flag to bypass demonstration labelling.

Set the path before launching Foundry, then restart it:

```powershell
$env:CATALYST_SLICER_CONFIG = "C:\FoundryProfiles\slicer.json"
# Launch the packaged Foundry application from this environment, or use npm run dev.
```

On Linux, `CATALYST_SLICER_CONFIG=/absolute/path/slicer.json npm run dev` selects the same configuration. Settings/status explain missing files, changed hashes, incomplete profiles and non-runnable binaries. Never put credentials in this configuration; offline slicing does not require them.

## Guided interface and exact binding

1. Select imported CAD parts and quantities; inspect orientations and placements.
2. Open **Slice & inspect** and explicitly choose **Use configured printer & profiles**. Foundry requests the resolved profile for the current process settings. It never silently swaps materials or machines.
3. Prepare and slice the exact job. The server validates geometry hashes, original unit declarations, classification, quantities and fit, then bakes every copy/orientation/placement into standard `unit="millimeter"` 3MF. Source imports remain untouched. The aggregate batch limit is 250,000 triangles and prepared-input limit 50 MiB; split larger batches deliberately.
4. The isolated worker runs the pinned CLI with immutable per-attempt profile copies, a dedicated data directory, automatic arrangement/orientation disabled, bounded logs and runtime, queued progress and cancellation. No shell and no machine-dispatch flags are used.
5. A result carries the exact manufacturing manifest hash and output hashes. If live inputs changed while slicing, the UI refuses to attach it. The exact resolved executable/machine/filament/process/plate bundle hash is persisted in `job.slicer.profileBundleHash` and therefore in approval fingerprints.
6. Review supported toolpaths. If Bambu output needs proprietary/unsupported commands, native project download remains available while Foundry approval is blocked. Open that artifact in the pinned target slicer for review; this application does not claim that native review occurred.

Supported UI settings map deterministically to complete process JSON: `layerHeight→layer_height`, `walls→wall_loops`, `infill→sparse_infill_density`, `supports→enable_support`, `brimWidth→brim_width`; `speed` maps explicitly to common outer/inner wall, infill, internal-solid, top-surface and gap-infill speeds. Travel and acceleration remain from the complete base profile. Unknown adapter settings are rejected, not ignored. Changes require explicitly reapplying the resolved profile and slicing again.

## Toolpath preview limits

The viewer parses actual G-code coordinates, not animated model cross-sections. Supported linear subset: `G0/G1`, explicit `G20/G21`, `G90/G91`, `M82/M83`, `G92`, feature comments, feedrates and retractions. Inch coordinates and extrusion convert explicitly to mm. Layer detection follows supported extrusion heights; startup purge moves can create additional displayed height groups compared with native slicer layer markers.

Unknown/proprietary commands, arcs, coordinate systems, homing, conditional macros, tool changes, nonplanar extrusion, missing units/extrusion mode and unsupported movement parameters produce warnings and block approval. Unknown proprietary argument grammars are not interpreted as supported movement. A partial linear preview cannot establish the coordinates of unmodelled machine motion. Machine temperature/flow/acceleration controls are not simulated.

Limits remain 10 MiB UTF-8, 250,000 segments, 100,000 mm coordinate magnitude and 16,384 characters per executable line. Nonexecuting full semicolon metadata comments may be longer within the total byte limit; Bambu embeds complete start scripts as comments. Actual executable duplicates, invalid values and oversized imports remain rejected. The unchanged G-code is retained and hashed. Imported toolpath mapping is an explicit operator attestation, not proof that external code used this CAD/settings.

`public/fixtures/bracket-demo.gcode` remains a manually authored, 24-layer demonstration fixture, never slicer-generated. Its marker is preserved and it can only yield a NON-MANUFACTURABLE demonstration package.

## Persistence, artifacts and failure behavior

Source geometry, prepared geometry, native sliced projects and final G-code are distinct artifacts. Attached native `slicerProject` bytes and SHA-256 survive save/reopen; approved packages include `slicer/job.3mf` and its checksum. Manifest metadata binds its hash without duplicating its bytes. Corrupt native bytes invalidate approval and export. Failed/interrupted preparation or slicing never creates an approval or release record. Native-review-only results remain in local worker history and can be downloaded separately. Until a supported result is attached, those worker artifacts are not embedded in a portable project or an approved package.

The separate service persists queued/running/succeeded/failed/cancelled/interrupted jobs. It serializes worker attempts, rejects reused action keys with different inputs, records actionable errors, cancels active and queued jobs on desktop shutdown, and marks unfinished persisted work interrupted after restart. Late cancelled results are discarded. Starting another attempt needs a fresh action key. Paths are server-owned and confined using portable Windows/POSIX checks; browsers cannot submit executable/input/output filesystem paths.

API contract: `GET /api/slicing/setup`; `POST /api/slicing/profile {settings}`; `POST /api/slicing/prepare {project,jobId}`; `POST /api/slicing/jobs {preparationId,manifestHash,idempotencyKey}`; `GET /api/slicing/jobs/:id`; `POST /api/slicing/jobs/:id/cancel`. `src/adapters/slicing.ts` provides typed wrappers. Setup/configuration status stays visibly unavailable until the actual pinned binary and profile gates pass.

## Reproduce the offline software smoke

With a deliberate untested local profile bundle configured:

```powershell
$env:CATALYST_SLICER_CONFIG = "C:\FoundryProfiles\slicer.json"
npx tsx scripts/smoke-slicer.ts "C:\FoundryWork\offline-smoke"
```

This deliberately uses shipped fixture CAD, three copies, a manual 90° X rotation and explicit placements. It saves native 3MF, G-code, prepared 3MF, hashes, logs, actual embedded settings and parser limitations with NON-MANUFACTURABLE labels. Inspect dimensions, copies, orientations and settings in native Bambu Studio on the intended platform. Do not print the smoke package. Linux CLI success does not verify a Windows installer or physical machine.

Automated tests distinguish synthetic injected CLI runners from actual subprocess evidence. They cover full-profile/mapped-setting hashes, real geometry preparation, byte/unit/fit failures, changed/revoked bindings, native artifacts, duplicate actions, cancellation, serialized queues, process termination, persistence/restart and portable path confinement. The real software smoke is additional evidence, not a replacement for those failure tests.

The [Bambu Connect guidance](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/) does not establish a general documented headless dispatch API. No private cloud/MQTT/FTP API is used. Assignment/export never means a machine accepted or started a job. Physical use still requires a qualified operator to verify machine, loaded material, nozzle, plate and clear bed; no physical condition or strength is verified by this software.
# Windows bundled engine

The Windows desktop now includes Bambu Studio 2.8.2.61 and twelve complete resolved mappings. Use the **Included engine** selector in Slice setup; no separate Studio installation or account is needed. Explicit profile review is still required. See [BUNDLED-SLICER.md](BUNDLED-SLICER.md) for the bundled path and [native results](WINDOWS-NATIVE-REPORT.md) for verified scope. The external configuration instructions below remain available for custom reviewed profiles.

