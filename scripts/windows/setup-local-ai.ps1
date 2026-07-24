[CmdletBinding()]
param(
    [switch]$PlanOnly,
    [switch]$SkipModels
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

function Get-UserSetting([string]$Name, [string]$Fallback) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ($value) { return $value }
    $value = [Environment]::GetEnvironmentVariable($Name, "User")
    if ($value) { return $value }
    return $Fallback
}

$repoRoot = Get-RepositoryRoot
$memoryGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$cpuName = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name).Trim()
$gpuNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join ", "
$nvidiaVramMb = 0
$nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if ($nvidiaSmi) {
    $vramValues = @(
        & $nvidiaSmi.Source --query-gpu=memory.total --format=csv,noheader,nounits 2>$null |
            ForEach-Object { if ($_ -match '^\s*(\d+)') { [int]$Matches[1] } }
    )
    if ($vramValues.Count) {
        $nvidiaVramMb = ($vramValues | Measure-Object -Maximum).Maximum
    }
}

# Leave memory for faster-whisper, the frontend, and the normal MVP services.
if ($nvidiaVramMb -ge 24576 -and $memoryGb -ge 64) {
    $autoOllamaModel = "exaone3.5:32b"
    $autoWhisperModel = "large-v3"
    $autoSttDevice = "cuda"
    $autoComputeType = "float16"
    $autoOllamaNumCtx = "8192"
    $autoRagUnload = "0"
} elseif ($nvidiaVramMb -ge 12288) {
    $autoOllamaModel = "exaone3.5:7.8b"
    $autoWhisperModel = "medium"
    $autoSttDevice = "cuda"
    $autoComputeType = "float16"
    $autoOllamaNumCtx = "8192"
    $autoRagUnload = "0"
} elseif ($nvidiaVramMb -ge 6144) {
    $autoOllamaModel = "exaone3.5:7.8b"
    $autoWhisperModel = "small"
    $autoSttDevice = "cuda"
    $autoComputeType = "float16"
    $autoOllamaNumCtx = "4096"
    $autoRagUnload = "0"
} elseif ($memoryGb -ge 16) {
    $autoOllamaModel = "exaone3.5:2.4b"
    $autoWhisperModel = "small"
    $autoSttDevice = "cpu"
    $autoComputeType = "int8"
    $autoOllamaNumCtx = "4096"
    $autoRagUnload = "1"
} else {
    $autoOllamaModel = "exaone3.5:2.4b"
    $autoWhisperModel = "base"
    $autoSttDevice = "cpu"
    $autoComputeType = "int8"
    $autoOllamaNumCtx = "2048"
    $autoRagUnload = "1"
}

$ollamaModel = Get-UserSetting "K7_OLLAMA_MODEL" $autoOllamaModel
$whisperModel = Get-UserSetting "K7_LIVE_STT_MODEL" $autoWhisperModel
$sttDevice = Get-UserSetting "K7_LIVE_STT_DEVICE" $autoSttDevice
$computeType = Get-UserSetting "K7_LIVE_STT_COMPUTE_TYPE" $autoComputeType
$ollamaNumCtx = Get-UserSetting "K7_OLLAMA_NUM_CTX" $autoOllamaNumCtx
$ollamaKeepAlive = Get-UserSetting "K7_OLLAMA_KEEP_ALIVE" "5m"
$ragUnload = Get-UserSetting "K7_RAG_UNLOAD_AFTER_QUERY" $autoRagUnload

Write-Host "K7 local AI profile" -ForegroundColor Cyan
Write-Host "CPU        : $cpuName"
Write-Host "Memory     : $memoryGb GB"
Write-Host "GPU        : $gpuNames"
Write-Host "NVIDIA VRAM: $([math]::Round($nvidiaVramMb / 1024, 1)) GB"
Write-Host "Summary    : Ollama $ollamaModel"
Write-Host "Context    : $ollamaNumCtx tokens"
Write-Host "STT        : faster-whisper $whisperModel / $sttDevice $computeType"

if ($PlanOnly) {
    Write-Host "Plan only: nothing was installed or changed." -ForegroundColor DarkGray
    return
}

$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonExe)) {
    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        # ``py -3`` selects the newest registered interpreter.  Preview or
        # partially removed Python versions can therefore win even when a
        # healthy 3.12 install is present.  Prefer the versions exercised by
        # the K7 backend and only fall back after proving the interpreter can
        # import its standard-library encodings module.
        $created = $false
        foreach ($selector in @("-3.12", "-3.11", "-3.13")) {
            & $pyLauncher.Source $selector -c "import encodings, sys; print(sys.executable)" 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) { continue }
            & $pyLauncher.Source $selector -m venv (Join-Path $repoRoot ".venv")
            if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $pythonExe)) {
                $created = $true
                break
            }
        }
        if (-not $created) {
            throw "Could not find a healthy Python 3.11-3.13 interpreter for the K7 environment."
        }
    } else {
        $pythonCommand = Get-Command python.exe -ErrorAction Stop
        & $pythonCommand.Source -m venv (Join-Path $repoRoot ".venv")
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pythonExe)) {
        throw "Could not create the repository .venv."
    }
}

Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
& $pythonExe -m pip install -r (Join-Path $repoRoot "backend\requirements.txt") -r (Join-Path $repoRoot "backend\requirements-live-stt.txt") websockets
if ($LASTEXITCODE -ne 0) {
    throw "Python dependency installation failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "node_modules"))) {
    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    Push-Location $repoRoot
    try {
        & $npmCommand.Source ci
        $npmExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($npmExitCode -ne 0) {
        throw "npm ci failed with exit code $npmExitCode"
    }
}

$settings = [ordered]@{
    K7_OLLAMA_MODEL = $ollamaModel
    K7_LIVE_STT_MODEL = $whisperModel
    K7_LIVE_STT_DEVICE = $sttDevice
    K7_LIVE_STT_COMPUTE_TYPE = $computeType
    K7_OLLAMA_NUM_CTX = $ollamaNumCtx
    K7_OLLAMA_KEEP_ALIVE = $ollamaKeepAlive
    K7_RAG_UNLOAD_AFTER_QUERY = $ragUnload
    OLLAMA_KV_CACHE_TYPE = "f16"
}
foreach ($entry in $settings.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "User")
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
}

if (-not $SkipModels) {
    $ollamaCommand = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if (-not $ollamaCommand) {
        $wingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $wingetCommand) {
            throw "Ollama is missing and winget.exe is unavailable. Install Ollama and rerun."
        }
        Write-Host "Installing Ollama for the current Windows user..." -ForegroundColor Yellow
        & $wingetCommand.Source install --id Ollama.Ollama --exact --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "Ollama installation failed with exit code $LASTEXITCODE"
        }
    }

    $ollamaCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:LOCALAPPDATA "Ollama\ollama.exe")
    )
    $ollamaCommand = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaPath = if ($ollamaCommand) { $ollamaCommand.Source } else { $null }
    if (-not $ollamaPath) {
        $ollamaPath = $ollamaCandidates |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1
    }
    if (-not $ollamaPath) {
        throw "ollama.exe was not found after installation. Sign out and in once, then rerun."
    }

    if (-not (Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $ollamaPath -ArgumentList @("serve") -WindowStyle Hidden
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while ([DateTime]::UtcNow -lt $deadline) {
            if (Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue) { break }
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not (Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue)) {
        throw "Ollama did not start on port 11434. Open Ollama once and rerun."
    }

    Write-Host "Downloading Ollama model: $ollamaModel ..." -ForegroundColor Yellow
    & $ollamaPath pull $ollamaModel
    if ($LASTEXITCODE -ne 0) {
        throw "Ollama model download failed with exit code $LASTEXITCODE"
    }

    Write-Host "Downloading faster-whisper model: $whisperModel ..." -ForegroundColor Yellow
    $cacheModelCode = @'
import sys
from faster_whisper import WhisperModel
WhisperModel(sys.argv[1], device=sys.argv[2], compute_type=sys.argv[3])
print(f"faster-whisper {sys.argv[1]} ready on {sys.argv[2]} {sys.argv[3]}")
'@
    & $pythonExe -c $cacheModelCode $whisperModel $sttDevice $computeType
    if ($LASTEXITCODE -ne 0 -and $sttDevice -eq "cuda") {
        Write-Host "CUDA STT initialization failed; retrying on CPU int8." -ForegroundColor Yellow
        $sttDevice = "cpu"
        $computeType = "int8"
        & $pythonExe -c $cacheModelCode $whisperModel $sttDevice $computeType
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Whisper model initialization failed with exit code $LASTEXITCODE"
    }
    [Environment]::SetEnvironmentVariable("K7_LIVE_STT_DEVICE", $sttDevice, "User")
    [Environment]::SetEnvironmentVariable("K7_LIVE_STT_COMPUTE_TYPE", $computeType, "User")
}

Write-Host ""
Write-Host "K7 local live-demo dependencies are ready." -ForegroundColor Green
Write-Host "Next: run scripts\windows\start-distributed-server.cmd"
