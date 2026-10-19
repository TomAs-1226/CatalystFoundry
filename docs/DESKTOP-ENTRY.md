# Start here — desktop robot entry

The visible-entry update is installed and reopened in the normal Foundry app.

## Use the new entry

1. Click **Add robot** in the header. It stays visible from every workflow page. Alternatively, open **Team parts** and paste the whole robot’s Onshape assembly link in the visible Robot’s Onshape link box, then choose Add robot.
2. In **Add robot from Onshape**, paste the link if needed and choose Open robot. The start-page link box fills this in and opens the saved CAD directly. Choose the intended saved version/assembly if the link is ambiguous, then Find robot parts.
3. Choose **Sync robot to team library**. This first pull fetches available CAD and automatically queues/uploads the geometry. Pending upload or capacity errors stay visible.
4. Choose the parts from **Team parts**, then **Add selected to draft plates**. Teammates use this same cloud catalog without another Onshape import. Parts already cached on their laptop remain available offline.

No project file is needed to start. **Open project** is an optional file/recovery command. **Save progress** retains the existing local workspace-save operation. Legacy portable-project sharing is excluded from the starting screen and source picker; it remains an advanced team-sync option. Local STL and demonstration fixtures remain under Advanced source options. The default 3D canvas layout is unchanged.

## Actual verification

- Native build exit 0 with Node 24.22.0; typecheck and 333 tests in 30 files passed.
- Original desktop lockfile unchanged: e9eb108462e7174af98b9c90d2a250891ffedd88480e99b10890fe8381380973.
- Existing isolated packaged save/reopen checks both exit 0. These check renderer startup/security and persistence; they do not test button visibility, clipping or the complete interactive workflow.
- Service bundle byte-identical to the previous installed cloud-library build: b547b5320354140ba4be64c6739de5af3c51db9624bcc849b03ee3a73f8596f1. No backend/cloud/Onshape-request behavior changed in this entry refinement.
- New NSIS install, isolated installed save/reopen and normal update all passed. Installed code, production assets, 6248 bundled slicer files and 12 mappings were checked. GitHub/Onshape connections are retained and the bundled Bambu slicer is available.
- Foundry UI computer use, screenshots and the interactive browser suite were not run under the user’s instruction. Visual confirmation and private/whole-robot CAD intake remain untested. No printer was contacted or started.

The website and Worker are unchanged from the prior cloud-library deployment. Cloud storage/API quotas still apply; initial Onshape pulls use the existing protective cap. Library reads, retries and cached preparation do not fetch Onshape again. The existing sharing audience is any signed-in GitHub account, and the Onshape pull screen discloses it. New revisions remain immutable; approvals/physical checks are not copied through cloud CAD.

Installer: Catalyst-Foundry-easy-entry-0.1.0-x64-Setup.exe

SHA-256: `83ab11523ca5f0161d72ce71b0879db251fa41bb6ccbfabb8fc465e2e06b7f54`

The regular output installer is the same current verified build. Earlier cloud-library reports describe their own dated validation and installer hashes.
