param(
    [string]$EnvFile = ".env.local-demo",
    [switch]$Offline
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

if (-not (Test-Path $EnvFile)) {
    throw "$EnvFile is missing. Run scripts/prepare-local-demo.ps1 while online first."
}

$composeArgs = @("compose", "--env-file", $EnvFile)
if ($Offline) {
    $composeArgs += @("-f", "compose.yaml", "-f", "compose.offline.yaml")
}
$composeArgs += @("up", "-d", "--no-build")

docker @composeArgs
& "$PSScriptRoot\doctor-local-demo.ps1" -EnvFile $EnvFile
