[CmdletBinding()]
param([switch]$SkipDependencyInstall)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Build this installer on native Windows x64; cloud Linux validation is insufficient.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Catalyst Foundry packaging currently supports Windows x64 only.' }
$RepoDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $RepoDirectory
$PreviousBuilderCache = $env:ELECTRON_BUILDER_CACHE
try {
  $NodeVersion = [version]((node --version).TrimStart('v'))
  if ($NodeVersion.Major -ne 24 -or $NodeVersion -lt [version]'24.19.0') { throw 'Install Node.js 24.19 or newer in the supported 24 LTS line, then open a new terminal.' }
  if (-not $SkipDependencyInstall) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  }
  if (-not (Test-Path 'vendor/bambu/runtime-manifest.json')) {
    & powershell -NoProfile -File scripts/windows/Prepare-Slicer.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Bundled Bambu preparation failed.' }
  }
  & node --import tsx scripts/windows/verify-vendor.ts
  if ($LASTEXITCODE -ne 0) { throw 'Bundled slicer integrity/license verification failed.' }
  & npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Type checking failed.' }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
  & powershell -NoProfile -File scripts/windows/Prepare-Builder.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Windows builder preparation failed.' }
  $env:ELECTRON_BUILDER_CACHE = Join-Path $RepoDirectory '.build-cache/electron-builder'
  & npm.cmd run dist:win
  if ($LASTEXITCODE -ne 0) { throw 'Installer packaging failed.' }
  $Installer = Get-ChildItem (Join-Path $RepoDirectory 'release/Catalyst-Foundry-*-x64-Setup.exe') | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $Installer) { throw 'Packaging completed without the expected installer EXE.' }
  $Hash = Get-FileHash $Installer.FullName -Algorithm SHA256
  "$($Hash.Hash.ToLowerInvariant())  $($Installer.Name)" | Set-Content ($Installer.FullName + '.sha256') -Encoding ASCII
  Write-Host "Built $($Installer.FullName)"
  Write-Host 'Build success does not establish install/launch success. Run Verify-Installer.ps1 next.'
} finally { $env:ELECTRON_BUILDER_CACHE = $PreviousBuilderCache; Pop-Location }
