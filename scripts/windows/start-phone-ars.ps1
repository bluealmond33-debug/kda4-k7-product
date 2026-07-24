[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [string]$HostIp,
    [ValidateSet("native", "edge")]
    [string]$AudioCaptureMode = "native",
    [string]$CallId,
    [string]$PythonPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding

function Get-RepositoryRoot {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
    if (-not (Test-Path -LiteralPath (Join-Path $candidate "package.json"))) {
        throw "Repository root could not be resolved from $PSScriptRoot"
    }
    return $candidate
}

function Get-RepositoryRuntimeDirectory([string]$RepositoryRoot) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($RepositoryRoot.ToLowerInvariant())
        $hash = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").Substring(0, 12)
    } finally {
        $sha.Dispose()
    }
    return Join-Path $env:LOCALAPPDATA ("K7\phone-ars\" + $hash)
}

function Resolve-Python([string]$RepositoryRoot, [string]$RequestedPath) {
    if ($RequestedPath) {
        if (Test-Path -LiteralPath $RequestedPath) {
            return (Resolve-Path -LiteralPath $RequestedPath).Path
        }
        $requestedCommand = Get-Command $RequestedPath -ErrorAction SilentlyContinue
        if ($requestedCommand) { return $requestedCommand.Source }
        throw "Python executable was not found: $RequestedPath"
    }
    $repoPython = Join-Path $RepositoryRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $repoPython) { return $repoPython }
    throw "Python environment not found: $repoPython. Run setup-local-ai.cmd first or pass -PythonPath."
}

function Get-UserSetting([string]$Name, [string]$Fallback) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ($value) { return $value }
    $value = [Environment]::GetEnvironmentVariable($Name, "User")
    if ($value) { return $value }
    return $Fallback
}

function Test-LocalPort([int]$Port) {
    return $null -ne (
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -First 1
    )
}

function Get-PreferredHostIp {
    $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254*" -and
            $_.AddressState -eq "Preferred"
        } |
        Sort-Object -Property @(
            @{ Expression = { if ($_.InterfaceAlias -match "Wi-Fi|Wireless|Local Area|Mobile Hotspot") { 0 } else { 1 } } },
            @{ Expression = { $_.InterfaceMetric } }
        ) |
        Select-Object -First 1 -ExpandProperty IPAddress
    return $address
}

$repoRoot = Get-RepositoryRoot
$pythonExe = Resolve-Python $repoRoot $PythonPath
$runtimeDir = Get-RepositoryRuntimeDirectory $repoRoot
$statePath = Join-Path $runtimeDir "processes.json"
$npmCommand = Get-Command npm.cmd -ErrorAction Stop

if (-not $HostIp) { $HostIp = Get-PreferredHostIp }
if ($AudioCaptureMode -eq "edge" -and -not $HostIp) {
    throw "A LAN host IP is required for edge audio mode. Pass -HostIp explicitly."
}
[System.IO.Directory]::CreateDirectory($runtimeDir) | Out-Null

$configuredModel = Get-UserSetting "K7_LIVE_STT_MODEL" "small"
$configuredDevice = Get-UserSetting "K7_LIVE_STT_DEVICE" "cpu"
$configuredCompute = Get-UserSetting "K7_LIVE_STT_COMPUTE_TYPE" "int8"
$configuredOllamaModel = Get-UserSetting "K7_OLLAMA_MODEL" "exaone3.5:2.4b"
$configuredOllamaNumCtx = Get-UserSetting "K7_OLLAMA_NUM_CTX" "4096"
$configuredOllamaKeepAlive = Get-UserSetting "K7_OLLAMA_KEEP_ALIVE" "5m"
$configuredRagUnload = Get-UserSetting "K7_RAG_UNLOAD_AFTER_QUERY" "1"

$env:K7_LIVE_STT_MODEL = $configuredModel
$env:K7_LIVE_STT_DEVICE = $configuredDevice
$env:K7_LIVE_STT_COMPUTE_TYPE = $configuredCompute
$env:K7_LIVE_STT_MAX_UTTERANCE_SECONDS = "3.2"
$env:K7_LIVE_STT_MIN_UTTERANCE_SECONDS = "0.6"
$env:K7_LIVE_STT_SILENCE_SECONDS = "0.45"
$env:K7_LIVE_STT_LEADING_SILENCE_SECONDS = "0.25"
$env:K7_AUDIO_CAPTURE_MODE = $AudioCaptureMode
$env:K7_OLLAMA_URL = "http://127.0.0.1:11434"
$env:K7_OLLAMA_MODEL = $configuredOllamaModel
$env:K7_OLLAMA_NUM_CTX = $configuredOllamaNumCtx
$env:K7_OLLAMA_KEEP_ALIVE = $configuredOllamaKeepAlive
$env:K7_RAG_UNLOAD_AFTER_QUERY = $configuredRagUnload
$env:OLLAMA_KV_CACHE_TYPE = "f16"

# This selects local providers only for the additive live-demo path.  It does
# not replace the repository's deployed mvp-1.0 batch contract or endpoints.
$env:PIPELINE_MODE = "local"
$env:LOCAL_STT_MODEL = $env:K7_LIVE_STT_MODEL
$env:LOCAL_STT_DEVICE = $env:K7_LIVE_STT_DEVICE
$env:LOCAL_STT_COMPUTE_TYPE = $env:K7_LIVE_STT_COMPUTE_TYPE
$env:OLLAMA_BASE_URL = $env:K7_OLLAMA_URL
$env:OLLAMA_MODEL = $env:K7_OLLAMA_MODEL
$env:OLLAMA_NUM_CTX = $env:K7_OLLAMA_NUM_CTX
$env:OLLAMA_KEEP_ALIVE = $env:K7_OLLAMA_KEEP_ALIVE
$localDatabaseUrl = [Environment]::GetEnvironmentVariable("K7_LOCAL_DATABASE_URL", "User")
if ($localDatabaseUrl) { $env:DATABASE_URL = $localDatabaseUrl }
$env:K7_EMBED = "bge-m3"
$env:K7_RAG_BATCH_SIZE = "16"
$env:K7_RAG_MAX_LENGTH = "256"
$env:VITE_USE_REAL_DATA_API = "true"
$env:VITE_API_BASE_URL = if ($HostIp) { "http://${HostIp}:8000" } else { "http://127.0.0.1:8000" }

$processState = [ordered]@{
    repository = $repoRoot
    started_at = [DateTime]::UtcNow.ToString("o")
    audio_capture_mode = $AudioCaptureMode
    processes = @()
}
$ownedProcesses = New-Object System.Collections.ArrayList
$backendStarted = $false
$frontendStarted = $false
$backendWasAlreadyRunning = Test-LocalPort 8000
$frontendWasAlreadyRunning = Test-LocalPort 5173

if (-not $backendWasAlreadyRunning) {
    $backendOut = Join-Path $runtimeDir "backend.out.log"
    $backendErr = Join-Path $runtimeDir "backend.err.log"
    $backend = Start-Process -FilePath $pythonExe `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000") `
        -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
    [void]$ownedProcesses.Add([ordered]@{ role = "backend-launcher"; pid = $backend.Id })
    $backendStarted = $true
} elseif ($AudioCaptureMode -eq "edge") {
    Write-Warning (
        "Port 8000 already has a server. It was not restarted, so the requested " +
        "edge mode and current code may not be active. Stop that server before the final rehearsal."
    )
}

if (-not $frontendWasAlreadyRunning) {
    Push-Location $repoRoot
    try {
        & $npmCommand.Source run build
        $frontendBuildExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($frontendBuildExitCode -ne 0) {
        throw "K7 frontend build failed with exit code $frontendBuildExitCode"
    }
    $frontendOut = Join-Path $runtimeDir "frontend.out.log"
    $frontendErr = Join-Path $runtimeDir "frontend.err.log"
    $frontend = Start-Process -FilePath $npmCommand.Source `
        -ArgumentList @("run", "preview", "--", "--host", "0.0.0.0", "--port", "5173") `
        -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr
    [void]$ownedProcesses.Add([ordered]@{ role = "frontend-launcher"; pid = $frontend.Id })
    $frontendStarted = $true
} elseif ($AudioCaptureMode -eq "edge") {
    Write-Warning (
        "Port 5173 already has a frontend. It was not rebuilt with the current " +
        "LAN API URL; stop it before the final rehearsal if remote screens fail."
    )
}

$deadline = [DateTime]::UtcNow.AddSeconds(25)
while ([DateTime]::UtcNow -lt $deadline) {
    if ((Test-LocalPort 8000) -and (Test-LocalPort 5173)) { break }
    Start-Sleep -Milliseconds 350
}
if (-not ((Test-LocalPort 8000) -and (Test-LocalPort 5173))) {
    throw "K7 servers did not start. Check logs in $runtimeDir"
}

if ($CallId -and $CallId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw "CallId must be 1-64 safe characters: letters, digits, dot, underscore, or hyphen."
}

# Registration is mandatory.  There is deliberately no implicit demo1 fallback:
# mistyped IDs must fail instead of creating disconnected phantom sessions.
$registrationBody = if ($CallId) {
    @{ call_id = $CallId } | ConvertTo-Json -Compress
} else {
    "{}"
}
try {
    $allocatedCall = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:8000/api/live-stt/calls" `
        -ContentType "application/json" `
        -Body $registrationBody `
        -TimeoutSec 8
} catch {
    throw (
        "Could not register a Call ID with POST /api/live-stt/calls. " +
        "No fallback ID was used. Check the backend log and retry. Reason: " +
        $_.Exception.Message
    )
}
$registeredCallId = [string]$allocatedCall.call_id
if ($registeredCallId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw "Server returned an invalid call_id."
}
if ($CallId -and $registeredCallId -ne $CallId) {
    throw "Server registered a different Call ID than requested."
}
$CallId = $registeredCallId
$callIdSource = if ($registrationBody -eq "{}") { "server" } else { "explicit-registered" }

if ($backendStarted) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { [void]$ownedProcesses.Add([ordered]@{ role = "backend-listener"; pid = $listener.OwningProcess }) }
}
if ($frontendStarted) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { [void]$ownedProcesses.Add([ordered]@{ role = "frontend-listener"; pid = $listener.OwningProcess }) }
}
$processState.processes = @($ownedProcesses)
$processState["call_id"] = $CallId
$processState["call_id_source"] = $callIdSource
[System.IO.File]::WriteAllText(
    $statePath,
    ($processState | ConvertTo-Json -Depth 5),
    [System.Text.UTF8Encoding]::new($false)
)

if (-not $HostIp) { $HostIp = "127.0.0.1" }
$encodedCallId = [System.Uri]::EscapeDataString($CallId)
$customerUrl = "http://${HostIp}:5173/?role=customer&call_id=${encodedCallId}"
$employeeUrl = "http://${HostIp}:5173/?role=employee&call_id=${encodedCallId}"
$adminUrl = "http://${HostIp}:5173/?role=admin&call_id=${encodedCallId}"

Write-Host ""
Write-Host "K7 additive live/edge demo is ready." -ForegroundColor Green
Write-Host "Customer : $customerUrl" -ForegroundColor Cyan
Write-Host "Employee : $employeeUrl" -ForegroundColor Cyan
Write-Host "Admin    : $adminUrl"
Write-Host "Call ID  : $CallId ($callIdSource)"
try {
    $analysis = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/live-stt/analysis-status" -TimeoutSec 3
    if ($analysis.available) {
        Write-Host "AI Summary: Ollama $($analysis.model)" -ForegroundColor Green
    } else {
        Write-Host "AI Summary: explicit local-rule fallback" -ForegroundColor Yellow
    }
} catch {
    Write-Host "AI Summary: status unavailable" -ForegroundColor Yellow
}
Write-Host "STT       : faster-whisper $env:K7_LIVE_STT_MODEL / $env:K7_LIVE_STT_DEVICE $env:K7_LIVE_STT_COMPUTE_TYPE"
Write-Host "Audio mode: $AudioCaptureMode"
Write-Host "Logs      : $runtimeDir"
if ($AudioCaptureMode -eq "edge") {
    Write-Host "Customer sender: start-customer-audio-edge.cmd -ServerUrl http://${HostIp}:8000 -CallId $CallId"
    Write-Host "Agent sender   : start-agent-audio-edge.cmd -ServerUrl http://${HostIp}:8000 -CallId $CallId"
    Write-Host "Scope: two-channel STT capture; no remote call-audio playback/relay." -ForegroundColor Yellow
    Write-Host "Counselor: use a headset to keep speaker audio out of the counselor microphone." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "The customer and employee screens must use this exact Call ID."
Write-Host "If Windows Firewall asks, allow Python and Node.js on the current private network."

if (-not $NoBrowser) {
    Start-Process $employeeUrl
}
