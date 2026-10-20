# Foundry for teammates

## Install and sign in

Download the Windows x64 Setup EXE from the [Foundry releases page](https://github.com/TomAs-1226/CatalystFoundry/releases). Use the version your team has qualified. Install for your Windows account, then open Catalyst Foundry. Bambu Studio's pinned slicing engine is included; you do not need a separate Studio installation.

Open **Project → Team sync & records** and sign in with GitHub. The included Catalyst service is already selected. Use your own account. The current team workspace admits every signed-in GitHub account, so share only CAD intended for that workspace. Your Onshape grant and personal preferences stay associated with your account.

Connect Onshape only if you need to add or update robot CAD. Teammates using an existing shared snapshot do not need to download its geometry from Onshape again. The [team website](https://tomas-1226.github.io/CatalystFoundrySync/) uses the same manufacturing records and parts library.

## Make a part from the shared robot

1. Open **Team parts**, find the robot and search its parts or subsystem. Use its cached parts. If the robot is missing, one teammate uses **Add robot** with the whole robot's Onshape assembly link and publishes the resulting immutable snapshot to the shared library. Initial discovery/export can use multiple Onshape calls; it is not a one-call import.
2. In **Prepare**, select the job and parts, review required and backup quantities, and apply the matching printer/nozzle/plate/material profile. Use the plate tools to orient, lay flat and arrange parts. Automatic placement is a starting point; check holes, fit, overhangs and strength direction. Open advanced settings only when needed.
3. In **Slice & inspect**, generate a fresh slice and inspect its layers, holes, walls, infill and supports. If a setting or placement changes, slice again. Unsupported command previews and demonstration geometry cannot receive manufacturing approval.
4. In **Approve**, confirm the exact current toolpath and operator checks. Use the same work order as the rest of your team. Required copies and backup copies have separate labels and reservations.
5. A supported Windows handoff opens **Bambu Connect** for native review. Connect owns login/pairing, printer selection and final Print. Foundry does not infer printer acceptance, printing or completion from opening Connect. Check the actual printer and report what you personally observed in Team sync & records.

## Offline work and records

Use **Save progress** or **Ctrl+S**. Local autosave also keeps completed changes on this laptop. Export a portable project for a transferable backup. Downloaded parts, preparation and bundled slicing can work without an internet connection.

Starting in 0.2.3, record reports and preference changes are saved to a durable local queue before Foundry says they are queued. A queued report is not yet a server-confirmed manufacturing state. The app checks records every 10 seconds while connected and retries after 5 seconds when disconnected; a detected reconnect also requests a retry. This traffic uses the team's sync service, not Onshape CAD APIs. An expired sign-in pauses delivery until you sign in again as the original account.

Keep the app open for background delivery. After reopening, the desktop resumes its saved queue. The website stores pending metadata in that browser's local storage and resumes it after signing in again; clearing site data deletes that browser's offline copies. A different account cannot send the original account's pending reports. Do not clear app/site data when reports are pending.

**New print reservations require internet.** Offline preparation does not guarantee that another teammate has not reserved those parts. A conflict stays visible in Pending delivery; open the latest record, check the physical situation and resolve it explicitly. Foundry never automatically overwrites another operator's report or releases copies on a timer.

## Updates and help

Use **Project → App updates**. Save before choosing **Save & restart**. Windows updates verify an Ed25519 signature and installer checksum. The Windows installer is not yet Authenticode signed. Mac builds are separate candidates and are usable only after the native Mac checks documented in [MACOS.md](MACOS.md) pass; Windows OTA does not update a Mac.

For a slower laptop, choose **Camera options → 3D quality → Low power**. Send a bug report with the app version, steps, the visible error and whether the geometry is missing before or after slicing. Share a public reproducer or exported fixture rather than private robot CAD or access tokens.
