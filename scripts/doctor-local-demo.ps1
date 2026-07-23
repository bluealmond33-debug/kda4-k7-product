param(
    [string]$EnvFile = ".env.local-demo"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI is not installed."
}
docker info | Out-Null

if (-not (Test-Path $EnvFile)) {
    throw "$EnvFile is missing."
}

$port = 8080
$portLine = Get-Content $EnvFile | Where-Object { $_ -match '^K7_HTTP_PORT=' } | Select-Object -First 1
if ($portLine) {
    $port = [int]($portLine -replace '^K7_HTTP_PORT=', '')
}

$health = $null
for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
        break
    }
    catch {
        if ($attempt -eq 12) {
            throw
        }
        Start-Sleep -Seconds 2
    }
}
if (
    $health.status -ne "ok" -or
    $health.database -ne "connected" -or
    $health.pipeline_mode -ne "local" -or
    $health.stt_provider -ne "faster_whisper" -or
    $health.analysis_provider -ne "ollama"
) {
    throw "K7 health check failed: $($health | ConvertTo-Json -Compress)"
}

$ollamaModels = docker compose --env-file $EnvFile exec -T ollama ollama list
if (-not ($ollamaModels -match 'exaone')) {
    Write-Warning "EXAONE is not listed in Ollama. Check OLLAMA_MODEL in $EnvFile."
}

$sttFiles = Get-ChildItem "models\whisper" -Recurse -File -ErrorAction SilentlyContinue
if (-not $sttFiles) {
    Write-Warning "No local STT model was found under models/whisper."
}

Write-Host "K7 local demo is ready: http://127.0.0.1:$port"
Write-Host "LAN clients: http://<this-laptop-private-ip>:$port"
