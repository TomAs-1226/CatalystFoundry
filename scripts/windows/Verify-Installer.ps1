[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$EvidenceDirectory = (Join-Path $env:TEMP ('CatalystFoundry-verification-' + [guid]::NewGuid().ToString('N'))),
  [string]$InstallDirectory
)
$ErrorActionPreference = 'Stop'
# This script is an independent process; verification must never inherit live integration paths.
$env:ONSHAPE_ACCESS_TOKEN_FILE = $null
$env:CATALYST_SLICER_CONFIG = $null
if ($env:OS -ne 'Windows_NT') { throw 'Installation verification requires native Windows.' }
$InstallerPath = (Resolve-Path $Installer).Path
if ([IO.Path]::GetExtension($InstallerPath) -ne '.exe') { throw 'Provide the generated NSIS installer EXE.' }
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
if (-not $InstallDirectory) { $InstallDirectory = Join-Path $EvidenceDirectory 'installed-app' }
# A short explicit target avoids upstream NSIS/Win32 path-length failures when
# retaining evidence under a deeply nested source workspace. Never reuse a target.
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$SmokeDataDirectory = Join-Path $EvidenceDirectory 'isolated-data'
if (Test-Path $InstallDirectory) { throw 'Use a new evidence directory; installation must be independently verifiable.' }
if (Test-Path $SmokeDataDirectory) { throw 'Use a new isolated data directory.' }
# NSIS requires /D to be the final argument, without surrounding quotes, even with spaces.
$Installed = Start-Process -FilePath $InstallerPath -ArgumentList "/S /D=$InstallDirectory" -WindowStyle Hidden -PassThru -Wait
if ($Installed.ExitCode -ne 0) { throw "Installer failed with exit code $($Installed.ExitCode)." }
$Application = Join-Path $InstallDirectory 'Catalyst Foundry.exe'
if (-not (Test-Path $Application)) { throw 'Installer did not create the expected application EXE.' }
foreach ($Phase in @('save', 'reopen')) {
  $Report = Join-Path $EvidenceDirectory ("launch-$Phase.json")
  $Arguments = @("`"--foundry-smoke-report=$Report`"", "`"--foundry-smoke-data=$SmokeDataDirectory`"", "--foundry-smoke-phase=$Phase")
  $Launched = Start-Process -FilePath $Application -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if (-not $Launched.WaitForExit(90000)) { Stop-Process -Id $Launched.Id -Force; throw "Installed application hung during $Phase verification." }
  $Launched.Refresh()
  if ($Launched.ExitCode -ne 0) { throw "Installed application failed during $Phase (exit $($Launched.ExitCode))." }
  if (-not (Test-Path $Report)) { throw "Installed application did not write the $Phase report." }
  $Result = Get-Content $Report -Raw | ConvertFrom-Json
  if (-not $Result.passed -or $Result.platform -ne 'win32' -or -not $Result.packaged -or -not $Result.loopbackBound -or -not $Result.crossOriginBlocked) {
    throw "Installed $Phase verification failed. Inspect $Report."
  }
  if (-not $Result.renderer.nodeUnavailable -or -not $Result.renderer.foundryVisible) { throw 'Renderer verification failed.' }
}
$Saved = Get-Content (Join-Path $EvidenceDirectory 'launch-save.json') -Raw | ConvertFrom-Json
$Reopened = Get-Content (Join-Path $EvidenceDirectory 'launch-reopen.json') -Raw | ConvertFrom-Json
if ($Saved.persistence.id -ne $Reopened.persistence.id) { throw 'The second launch reopened a different project.' }
$Signature = Get-AuthenticodeSignature $InstallerPath
$Summary = @{
  passed = $true; verifiedAt = [DateTime]::UtcNow.ToString('o'); operatingSystem = [Environment]::OSVersion.VersionString
  installer = $InstallerPath; installerSha256 = (Get-FileHash $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  authenticodeStatus = $Signature.Status.ToString(); application = $Application; projectId = $Saved.persistence.id
  evidenceDirectory = $EvidenceDirectory
  scope = 'Native Windows per-user installation, real renderer launch, isolated save/reopen, loopback/security checks. No printers or authorised service accounts exercised.'
}
$Summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $EvidenceDirectory 'verification-summary.json') -Encoding UTF8
Write-Host "Installation and two launches verified. Evidence: $EvidenceDirectory"
Write-Host 'Keep the generated reports. Validate live Onshape and a reviewed slicer profile separately.'
