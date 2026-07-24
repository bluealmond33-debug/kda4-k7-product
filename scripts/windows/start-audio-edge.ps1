[CmdletBinding()]
param(
    [ValidateSet("customer", "agent")]
    [string]$Role = "customer",
    [string]$ServerUrl,
    [string]$CallId,
    [string]$Device,
    [ValidateRange(20, 500)]
    [int]$BlockMilliseconds = 100,
    [ValidateRange(0.1, 120.0)]
    [double]$ReconnectInitialSeconds = 1.0,
    [ValidateRange(0.1, 300.0)]
    [double]$ReconnectMaxSeconds = 10.0,
    [switch]$ListDevices,
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
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) { return $pythonCommand.Source }
    throw "Python was not found. Create .venv or pass -PythonPath."
}

function Get-Setting([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    if ($value) { return $value }
    return [Environment]::GetEnvironmentVariable($Name, "User")
}

$repoRoot = Get-RepositoryRoot
$pythonExe = Resolve-Python $repoRoot $PythonPath
$senderScript = Join-Path $PSScriptRoot "audio_edge_sender.py"
if (-not (Test-Path -LiteralPath $senderScript)) {
    throw "Audio sender script was not found: $senderScript"
}

if (-not $ServerUrl) { $ServerUrl = Get-Setting "K7_AUDIO_SERVER_URL" }
if (-not $ServerUrl) { $ServerUrl = "http://127.0.0.1:8000" }
if (-not $CallId) { $CallId = Get-Setting "K7_CALL_ID" }

if (-not $ListDevices) {
    if (-not $CallId) {
        throw (
            "CallId is required. Copy the Call ID printed by " +
            "start-distributed-server.cmd, pass -CallId, or set K7_CALL_ID."
        )
    }
    if ($CallId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
        throw "CallId must be 1-64 safe characters: letters, digits, dot, underscore, or hyphen."
    }
}

$senderArgs = @($senderScript)
if ($ListDevices) {
    $senderArgs += "--list-devices"
} else {
    $senderArgs += @(
        "--speaker", $Role,
        "--server", $ServerUrl,
        "--call-id", $CallId,
        "--block-ms", "$BlockMilliseconds",
        "--reconnect-initial", $ReconnectInitialSeconds.ToString([System.Globalization.CultureInfo]::InvariantCulture),
        "--reconnect-max", $ReconnectMaxSeconds.ToString([System.Globalization.CultureInfo]::InvariantCulture)
    )
    if ($Device) { $senderArgs += @("--device", $Device) }
}

Write-Host "K7 Windows audio edge sender" -ForegroundColor Cyan
Write-Host "Python : $pythonExe"
if (-not $ListDevices) {
    Write-Host "Role   : $Role"
    Write-Host "Server : $ServerUrl"
    Write-Host "Call ID: $CallId"
    if ($Device) {
        Write-Host "Device : $Device"
    } elseif ($Role -eq "customer") {
        Write-Host "Device : automatic WO Mic search"
    } else {
        Write-Host "Device : Windows default input"
    }
}
Write-Host ""

& $pythonExe @senderArgs
exit $LASTEXITCODE
