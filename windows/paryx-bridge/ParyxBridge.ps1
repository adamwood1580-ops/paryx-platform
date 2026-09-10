param(
    [string]$ConfigPath = "C:\ProgramData\ParyxBridge\config.json"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-BridgeLog {
    param([string]$Message)
    $root = Split-Path -Parent $ConfigPath
    $logDir = Join-Path $root "Logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $logFile = Join-Path $logDir ("ParyxBridge-{0}.log" -f (Get-Date -Format "yyyy-MM"))
    Add-Content -Path $logFile -Value ("{0:u} {1}" -f (Get-Date), $Message)
}

function Get-StableCsvFiles {
    param([string]$Folder)
    if (-not (Test-Path $Folder)) { return @() }
    return Get-ChildItem -Path $Folder -Filter *.csv -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddSeconds(-8) } |
        Sort-Object LastWriteTime
}

function Move-Unique {
    param([System.IO.FileInfo]$File, [string]$DestinationFolder)
    New-Item -ItemType Directory -Force -Path $DestinationFolder | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $base = [IO.Path]::GetFileNameWithoutExtension($File.Name)
    $dest = Join-Path $DestinationFolder ("{0}-{1}.csv" -f $base, $stamp)
    $counter = 1
    while (Test-Path $dest) {
        $dest = Join-Path $DestinationFolder ("{0}-{1}-{2}.csv" -f $base, $stamp, $counter)
        $counter++
    }
    Move-Item -LiteralPath $File.FullName -Destination $dest
}

if (-not (Test-Path $ConfigPath)) {
    throw "Paryx Bridge config not found: $ConfigPath"
}

$config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
if (-not $config.endpoint -or -not $config.device_token -or -not $config.watch_folder) {
    throw "Paryx Bridge config is incomplete."
}

$watchFolder = [string]$config.watch_folder
$root = Split-Path -Parent $ConfigPath
$processedFolder = Join-Path $root "Processed"
$failedFolder = Join-Path $root "Failed"
$pollSeconds = [Math]::Max(15, [int]($config.poll_seconds | ForEach-Object { if ($_){$_}else{30} }))

New-Item -ItemType Directory -Force -Path $watchFolder, $processedFolder, $failedFolder | Out-Null
Write-BridgeLog "Bridge started. Watching $watchFolder"

$attempts = @{}

while ($true) {
    try {
        foreach ($file in (Get-StableCsvFiles -Folder $watchFolder)) {
            try {
                $beforeLength = $file.Length
                Start-Sleep -Seconds 2
                $refreshed = Get-Item -LiteralPath $file.FullName -ErrorAction Stop
                if ($refreshed.Length -ne $beforeLength) { continue }

                $csvText = Get-Content -Raw -Path $refreshed.FullName
                $payload = @{
                    action = "bridge_csv"
                    filename = $refreshed.Name
                    csv_text = $csvText
                } | ConvertTo-Json -Depth 5

                Write-BridgeLog "Submitting $($refreshed.Name) ($($refreshed.Length) bytes)."
                $response = Invoke-RestMethod -Method Post -Uri ([string]$config.endpoint) -Headers @{
                    "X-Paryx-Bridge-Token" = [string]$config.device_token
                } -ContentType "application/json" -Body $payload -TimeoutSec 45

                if ($response.ok -eq $true) {
                    $status = [string]$response.status
                    Write-BridgeLog "Accepted $($refreshed.Name). Status=$status Competition=$($response.competition_name)"
                    Move-Unique -File $refreshed -DestinationFolder $processedFolder
                    $attempts.Remove($refreshed.FullName)
                } else {
                    throw ([string]($response.error | ForEach-Object { if ($_){$_}else{"Paryx rejected the file."} }))
                }
            }
            catch {
                $key = $file.FullName
                $count = 1
                if ($attempts.ContainsKey($key)) { $count = [int]$attempts[$key] + 1 }
                $attempts[$key] = $count
                Write-BridgeLog "Upload failed for $($file.Name), attempt $count: $($_.Exception.Message)"

                if ($count -ge 3 -and (Test-Path $file.FullName)) {
                    Write-BridgeLog "Moving $($file.Name) to Failed after three attempts."
                    Move-Unique -File (Get-Item $file.FullName) -DestinationFolder $failedFolder
                    $attempts.Remove($key)
                }
            }
        }
    }
    catch {
        Write-BridgeLog "Bridge loop error: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $pollSeconds
}
