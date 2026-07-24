[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [string]$HostIp,
    [string]$CallId
)

$ErrorActionPreference = "Stop"
$startScript = Join-Path $PSScriptRoot "start-phone-ars.ps1"
if (-not (Test-Path -LiteralPath $startScript)) {
    throw "Server start script was not found: $startScript"
}

$parameters = @{
    AudioCaptureMode = "edge"
    NoBrowser = $NoBrowser
}
if ($HostIp) { $parameters.HostIp = $HostIp }
if ($CallId) { $parameters.CallId = $CallId }

& $startScript @parameters
exit $LASTEXITCODE
