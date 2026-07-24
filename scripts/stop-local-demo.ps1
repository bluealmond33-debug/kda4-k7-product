param(
    [string]$EnvFile = ".env.local-demo",
    [switch]$Offline
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$composeArgs = @("compose", "--env-file", $EnvFile)
if ($Offline) {
    $composeArgs += @("-f", "compose.yaml", "-f", "compose.offline.yaml")
}
$composeArgs += @("down")
docker @composeArgs
