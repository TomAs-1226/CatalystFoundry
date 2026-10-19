[CmdletBinding()]
param(
  [string]$Application,
  [string]$OnshapeTokenFile,
  [string]$SlicerConfig
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This launcher is for the Windows desktop application.' }
if (-not $Application) {
  # In the installed package this script lives at resources/setup/Start-Foundry.ps1.
  $Application = Join-Path $PSScriptRoot '../../Catalyst Foundry.exe'
}
$Application = (Resolve-Path $Application).Path
$PreviousTokenPath = $env:ONSHAPE_ACCESS_TOKEN_FILE
$PreviousSlicerPath = $env:CATALYST_SLICER_CONFIG
try {
  if ($OnshapeTokenFile) { $env:ONSHAPE_ACCESS_TOKEN_FILE = (Resolve-Path $OnshapeTokenFile).Path }
  if ($SlicerConfig) { $env:CATALYST_SLICER_CONFIG = (Resolve-Path $SlicerConfig).Path }
  # Only file paths are passed. This script never reads tokens or modifies machine/user environment settings.
  Start-Process -FilePath $Application -WindowStyle Hidden | Out-Null
  Write-Host 'Foundry launch requested. The application reports whether authorisation and the slicer profile are actually usable.'
  Write-Host 'If Foundry was already running, exit it fully and launch again to apply changed integration paths.'
} finally {
  $env:ONSHAPE_ACCESS_TOKEN_FILE = $PreviousTokenPath
  $env:CATALYST_SLICER_CONFIG = $PreviousSlicerPath
}
