param(
    [string]$EnvFile = ".env.local-demo",
    [string]$SttModel = "small",
    [string]$OllamaModel = "exaone3.5:2.4b"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not (Test-Path $EnvFile)) {
    Copy-Item ".env.local-demo.example" $EnvFile
    Write-Host "Created $EnvFile. Change the demo password before team use."
}

docker info | Out-Null
docker compose --env-file $EnvFile build frontend backend
if ($LASTEXITCODE -ne 0) { throw "Docker image build failed." }
docker compose --env-file $EnvFile up -d db ollama
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL/Ollama startup failed." }
docker compose --env-file $EnvFile exec ollama ollama pull $OllamaModel
if ($LASTEXITCODE -ne 0) { throw "Ollama model download failed." }
docker compose --env-file $EnvFile run --rm backend `
    python backend/scripts/download_stt_model.py --model $SttModel --output /models/whisper
if ($LASTEXITCODE -ne 0) { throw "faster-whisper model download failed." }

Write-Host "Local models and images are ready. Run scripts/start-local-demo.ps1."
