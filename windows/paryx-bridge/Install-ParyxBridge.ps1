param(
    [Parameter(Mandatory=$true)]
    [string]$ConfigFile,
    [switch]$KeepSourceConfig
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run PowerShell as Administrator to install Paryx Bridge."
}

if (-not (Test-Path $ConfigFile)) { throw "Config file not found: $ConfigFile" }
$config = Get-Content -Raw -Path $ConfigFile | ConvertFrom-Json
if (-not $config.endpoint -or -not $config.device_token -or -not $config.watch_folder) {
    throw "The downloaded Paryx Bridge config file is incomplete."
}

$installRoot = "C:\ProgramData\ParyxBridge"
$scriptSource = Join-Path $PSScriptRoot "ParyxBridge.ps1"
$scriptDest = Join-Path $installRoot "ParyxBridge.ps1"
$configDest = Join-Path $installRoot "config.json"
$watchFolder = [string]$config.watch_folder

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
New-Item -ItemType Directory -Force -Path $watchFolder | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "Processed") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "Failed") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot "Logs") | Out-Null

Copy-Item -Force -Path $scriptSource -Destination $scriptDest
Copy-Item -Force -Path $ConfigFile -Destination $configDest

# Restrict the credential-bearing config to SYSTEM and local Administrators.
& icacls $configDest /inheritance:r /grant:r "SYSTEM:F" "BUILTIN\Administrators:F" | Out-Null
# Ordinary signed-in club users need to be able to export CSV files to this one folder.
& icacls $watchFolder /grant "BUILTIN\Users:(OI)(CI)M" | Out-Null

$taskName = "Paryx Competition Result Bridge"
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptDest`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principalTask = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principalTask -Settings $settings -Description "Uploads ClubV1 competition result CSV exports from the designated Paryx folder to the Paryx result-ingest endpoint over HTTPS." | Out-Null
Start-ScheduledTask -TaskName $taskName

if (-not $KeepSourceConfig -and ((Resolve-Path $ConfigFile).Path -ne (Resolve-Path $configDest).Path)) {
    Remove-Item -Force -Path $ConfigFile -ErrorAction SilentlyContinue
}

Write-Host "Paryx Bridge installed successfully."
Write-Host "Watch folder: $watchFolder"
Write-Host "Service files: $installRoot"
Write-Host "Scheduled task: $taskName"
