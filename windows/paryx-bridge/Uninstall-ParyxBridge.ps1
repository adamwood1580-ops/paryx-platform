param([switch]$RemoveArchivedFiles)
$ErrorActionPreference = "Stop"
$taskName = "Paryx Competition Result Bridge"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$root = "C:\ProgramData\ParyxBridge"
if (Test-Path $root) {
    if ($RemoveArchivedFiles) {
        Remove-Item -Recurse -Force $root
    } else {
        Remove-Item -Force (Join-Path $root "config.json") -ErrorAction SilentlyContinue
        Remove-Item -Force (Join-Path $root "ParyxBridge.ps1") -ErrorAction SilentlyContinue
    }
}
Write-Host "Paryx Bridge scheduled task and device credential have been removed from this PC. Revoke the device in Paryx ClubHub as well."
