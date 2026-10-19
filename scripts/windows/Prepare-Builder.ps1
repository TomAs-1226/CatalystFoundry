[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RepoDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$CacheDirectory = Join-Path $RepoDirectory '.build-cache/electron-builder'
$Archive = Join-Path $CacheDirectory 'winCodeSign-2.6.0.7z'
$TargetDirectory = Join-Path $CacheDirectory 'winCodeSign/winCodeSign-2.6.0'
New-Item -ItemType Directory -Force $CacheDirectory,$TargetDirectory | Out-Null
if (-not (Test-Path $Archive)) { Invoke-WebRequest 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile $Archive }
if ((Get-FileHash $Archive -Algorithm SHA512).Hash.ToLowerInvariant() -ne 'e8b408d9df413c2dd7b346684d07b5a37b4f880dbc73bf8f63af50f62fe90fc958e39a6c32d1ee2f0bf7bd1724895af7671d5c6cdc8b94147c493c0275c1f0b4') { throw 'Windows resource/signing tool archive SHA-512 mismatch.' }
# Windows needs these PE tools, not the macOS dylib symlinks that require an unrelated OS privilege.
& (Join-Path $RepoDirectory 'node_modules/7zip-bin/win/x64/7za.exe') x -y -bd $Archive "-o$TargetDirectory" '-xr!darwin' '-xr!linux'
if ($LASTEXITCODE -ne 0) { throw 'Windows builder tool extraction failed.' }
if (-not (Test-Path (Join-Path $TargetDirectory 'rcedit-x64.exe'))) { throw 'Windows resource editor is missing.' }
Write-Host "Prepared pinned Windows build tools in $CacheDirectory"
$NsisArchive = Join-Path $CacheDirectory 'nsis-3.0.4.1.7z'
if (-not (Test-Path $NsisArchive)) { Invoke-WebRequest 'https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z' -OutFile $NsisArchive }
$NsisHash = [Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash([IO.File]::ReadAllBytes($NsisArchive)))
if ($NsisHash -ne 'VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q==') { throw 'NSIS archive checksum differs from the pinned electron-builder checksum.' }
& (Join-Path $RepoDirectory 'node_modules/7zip-bin/win/x64/7za.exe') x -y -bd $NsisArchive "-o$(Join-Path $CacheDirectory 'nsis/nsis-3.0.4.1')"
if ($LASTEXITCODE -ne 0) { throw 'NSIS extraction failed.' }
