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
$legacyOperations = [ordered]@{
    "/stt" = "post"
    "/analyze" = "post"
    "/judge" = "post"
    "/rag" = "post"
    "/analyze-text" = "post"
    "/emotion" = "post"
    "/summarize" = "post"
    "/briefing" = "post"
}

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
$missingLegacyOperations = @(
    foreach ($operation in $legacyOperations.GetEnumerator()) {
        $pathProperty = $openapi.paths.PSObject.Properties[$operation.Key]
        $methodProperty = if ($null -ne $pathProperty) {
            $pathProperty.Value.PSObject.Properties[$operation.Value]
        }
        if ($null -eq $pathProperty -or $null -eq $methodProperty) {
            "$($operation.Value.ToUpperInvariant()) $($operation.Key)"
        }
    }
)
$hasPostCalls = [bool]$openapi.paths."/api/v1/calls".post
$hasGetCard = [bool]$openapi.paths."/api/v1/calls/{call_id}/consultation-card".get
$databaseConnected = $health.database -eq "connected"
$contractReady = $health.contract_version -eq "mvp-1.0"

$ready = (
    $missingMvpPaths.Count -eq 0 -and
    $missingLegacyOperations.Count -eq 0 -and
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
    legacy_operations_ready = $missingLegacyOperations.Count -eq 0
    missing_mvp_paths = $missingMvpPaths
    missing_legacy_operations = $missingLegacyOperations
} | ConvertTo-Json -Depth 5

if (-not $ready) {
    exit 2
}
