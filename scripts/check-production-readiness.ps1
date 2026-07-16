param(
    [string]$ApiBaseUrl = "https://kda4-k7-backend-production.up.railway.app"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding
$baseUrl = $ApiBaseUrl.TrimEnd("/")
$requiredPaths = @(
    "/api/v1/calls",
    "/api/v1/calls/{call_id}/consultation-card"
)
$legacyPaths = @(
    "/stt",
    "/analyze",
    "/judge",
    "/rag",
    "/analyze-text",
    "/emotion",
    "/summarize",
    "/briefing"
)

try {
    $openapi = Invoke-RestMethod -Uri "$baseUrl/openapi.json" -Method Get
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
} catch {
    [pscustomobject]@{
        ready = $false
        api_base_url = $baseUrl
        error = $_.Exception.Message
    } | ConvertTo-Json -Depth 5
    exit 2
}

$actualPaths = @($openapi.paths.PSObject.Properties.Name)
$missingMvpPaths = @($requiredPaths | Where-Object { $_ -notin $actualPaths })
$missingLegacyPaths = @($legacyPaths | Where-Object { $_ -notin $actualPaths })
$hasPostCalls = [bool]$openapi.paths."/api/v1/calls".post
$hasGetCard = [bool]$openapi.paths."/api/v1/calls/{call_id}/consultation-card".get
$databaseConnected = $health.database -eq "connected"
$contractReady = $health.contract_version -eq "mvp-1.0"

$ready = (
    $missingMvpPaths.Count -eq 0 -and
    $missingLegacyPaths.Count -eq 0 -and
    $hasPostCalls -and
    $hasGetCard -and
    $databaseConnected -and
    $contractReady
)

[pscustomobject]@{
    ready = $ready
    api_base_url = $baseUrl
    api_version = $openapi.info.version
    path_count = $actualPaths.Count
    post_calls = $hasPostCalls
    get_consultation_card = $hasGetCard
    database = $health.database
    contract_version = $health.contract_version
    missing_mvp_paths = $missingMvpPaths
    missing_legacy_paths = $missingLegacyPaths
} | ConvertTo-Json -Depth 5

if (-not $ready) {
    exit 2
}
