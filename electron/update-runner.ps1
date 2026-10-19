$ErrorActionPreference='Stop'
$Installer=$env:CATALYST_UPDATE_INSTALLER
$Application=$env:CATALYST_UPDATE_APPLICATION
$WaitProcessId=[int]$env:CATALYST_UPDATE_PARENT
$ExpectedSha256=$env:CATALYST_UPDATE_SHA256
$ResultFile=$env:CATALYST_UPDATE_RESULT
try {
 foreach($file in @($Installer,$Application,$ResultFile,$env:CATALYST_UPDATE_READY)){if(-not[IO.Path]::IsPathRooted($file)){throw 'Update helper requires native absolute paths.'}}
 Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
 if((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Update bytes changed before restart.'}
 @{ready=$true;processId=$PID;sha256=$ExpectedSha256} | ConvertTo-Json | Set-Content -LiteralPath $env:CATALYST_UPDATE_READY -Encoding UTF8
 $parent=Get-Process -Id $WaitProcessId -ErrorAction SilentlyContinue
 if($parent -and -not $parent.WaitForExit(90000)){throw 'Foundry did not close; update was not installed.'}
 if((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedSha256){throw 'Update bytes changed before installation.'}
 $installed=Start-Process -FilePath $Installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
 if($installed.ExitCode -ne 0){throw "Update installer failed: $($installed.ExitCode)"}
 if(-not(Test-Path -LiteralPath $Application)){throw 'Installed application was not found.'}
 @{passed=$true;installerExitCode=$installed.ExitCode;verifiedAt=[DateTime]::UtcNow.ToString('o');sha256=$ExpectedSha256} | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding UTF8
 Start-Process -FilePath $Application
} catch {
 @{passed=$false;error=$_.Exception.Message;verifiedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding UTF8
 exit 1
}
