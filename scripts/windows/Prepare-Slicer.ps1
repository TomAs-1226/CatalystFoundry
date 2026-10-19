[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RepoDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $RepoDirectory
try {
  $CacheDirectory = Join-Path $RepoDirectory '.build-cache'
  New-Item -ItemType Directory -Force $CacheDirectory | Out-Null
  $Archive = Join-Path $CacheDirectory 'BambuStudio-2.8.2.61.zip'
  $ArchiveHash = '3faaa194a90a2e7defa39a6a63f5a654b8cdb762c6a98556cf771fba582229f5'
  if (-not (Test-Path $Archive)) { Invoke-WebRequest 'https://github.com/bambulab/BambuStudio/releases/download/v02.08.02.61/Bambu_Studio_win-v02.08.02.61-20260820225108.zip' -OutFile $Archive }
  if ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ArchiveHash) { throw 'Official Bambu portable archive SHA-256 mismatch.' }
  $Extracted = Join-Path $CacheDirectory 'BambuStudio-2.8.2.61'
  Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted -Force
  & node --import tsx scripts/windows/prepare-bambu.ts $Extracted
  if ($LASTEXITCODE -ne 0) { throw 'Bundled slicer preparation failed.' }
  New-Item -ItemType Directory -Force vendor/licenses | Out-Null
  $Source = Join-Path $RepoDirectory 'vendor/licenses/BambuStudio-v02.08.02.61-source.tar.gz'
  if (-not (Test-Path $Source)) { Invoke-WebRequest 'https://codeload.github.com/bambulab/BambuStudio/tar.gz/refs/tags/v02.08.02.61' -OutFile $Source }
  if ((Get-FileHash $Source -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'fccea7043da48dfd05b98fdfc341cb29d0169880f3b3ae6bedf00ebfd3be7d28') { throw 'Bambu source archive SHA-256 mismatch.' }
  & tar -xf $Source -C vendor/licenses BambuStudio-02.08.02.61/LICENSE
  if ($LASTEXITCODE -ne 0) { throw 'Could not retain upstream license.' }
  Copy-Item docs/BUNDLED-SLICER.md vendor/licenses/BUNDLED-SLICER.md
} finally { Pop-Location }
