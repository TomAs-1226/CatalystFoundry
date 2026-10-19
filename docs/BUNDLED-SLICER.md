# Included offline slicing engine

Foundry bundles the unmodified official Windows x64 portable Bambu Studio **2.8.2.61** runtime and its matching upstream profile tree. No separate Studio installation, account or printer connection is required. Debug symbols and development headers are omitted. Foundry invokes the documented CLI as a separate local process; it does not start Studio's interactive application, provision a networking plugin or dispatch to a machine.

Official release: https://github.com/bambulab/BambuStudio/releases/tag/v02.08.02.61

Portable ZIP SHA-256: `3faaa194a90a2e7defa39a6a63f5a654b8cdb762c6a98556cf771fba582229f5`.

Matching source: https://github.com/bambulab/BambuStudio/tree/v02.08.02.61. The installed `resources/licenses/` folder contains the source archive, its AGPL-3.0 license and this notice. Source archive SHA-256: `fccea7043da48dfd05b98fdfc341cb29d0169880f3b3ae6bedf00ebfd3be7d28`. Third-party notices shipped in the upstream runtime are retained. Bambu Studio belongs to its upstream authors; Foundry is a separate application and makes no claim of Bambu endorsement.

In Slice & inspect, expand **Included engine**, choose the exact printer/material mapping, review the 0.4 mm nozzle and Textured PEI Plate, then enable the reviewed mapping. Apply **Use configured printer & profiles** to the job and slice. Twelve mappings cover P1S, X1, X1 Carbon, X2D, A1 and A1 mini with Generic PLA or PETG. They are fully resolved from this release, not hand-authored fragments. Build volume comes from the resolved upstream machine profile. All mappings retain `tested:false`; no physical qualification is implied. Existing external reviewed configuration through `CATALYST_SLICER_CONFIG` remains supported.

The selection is stored only in Foundry's per-user data. The complete runtime inventory and resolved profiles are hashed. The runtime manifest hash joins the exact-job fingerprint; every runtime file is checked at profile selection, service reopen and immediately before slicing. Changes require review and a new matching toolpath. Proprietary commands unsupported by Foundry's preview still require native review and cannot be approved here. Demonstration CAD remains non-manufacturable even when processed by the genuine engine.

Build preparation: `powershell -NoProfile -File scripts/windows/Prepare-Slicer.ps1`. It downloads only the pinned official ZIP and source, verifies both, resolves the catalog, and generates the runtime inventory. Runtime use requires no download. `Build-Installer.ps1` runs preparation if the runtime is absent.

The X2D mapping retains the upstream dual-nozzle machine configuration, both 0.4 mm diameters and the profile primary-nozzle default. Foundry exposes a single selected filament; multi-material/tool assignment is not provided. Always review the actual native result and target in Connect.
