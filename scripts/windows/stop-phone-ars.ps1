$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

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

function Stop-ProcessTree([int]$ProcessId) {
    if ($ProcessId -le 0) { return }
    $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $ProcessId }
    foreach ($child in $children) {
        Stop-ProcessTree ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$repoRoot = Get-RepositoryRoot
$runtimeDir = Get-RepositoryRuntimeDirectory $repoRoot
$statePath = Join-Path $runtimeDir "processes.json"

if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host "No K7 server state was found for this repository." -ForegroundColor Yellow
    return
}

$state = Get-Content -Raw -LiteralPath $statePath -Encoding UTF8 | ConvertFrom-Json
if ($state.repository -ne $repoRoot) {
    throw "Refusing to stop processes: runtime state belongs to a different repository."
}

$processIds = @(
    $state.processes |
        ForEach-Object { [int]$_.pid } |
        Where-Object { $_ -gt 0 } |
        Select-Object -Unique
)
foreach ($processId in $processIds) {
    Stop-ProcessTree $processId
}

$resolvedRuntime = [System.IO.Path]::GetFullPath($runtimeDir)
$resolvedState = [System.IO.Path]::GetFullPath($statePath)
if (-not $resolvedState.StartsWith($resolvedRuntime, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a state file outside the K7 runtime directory."
}
Remove-Item -LiteralPath $resolvedState -Force

Write-Host "K7 demo servers started by this repository were stopped." -ForegroundColor Green
