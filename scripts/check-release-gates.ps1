param(
    [string]$ApiBaseUrl = "https://kda4-k7-backend-production.up.railway.app",
    [string]$FrontendUrl = "https://k7product.vercel.app",
    [string]$AudioPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding

$apiBase = $ApiBaseUrl.TrimEnd("/")
$frontendBase = $FrontendUrl.TrimEnd("/")
$result = [ordered]@{
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    api_base_url = $apiBase
    frontend_url = $frontendBase
    backend_ready = $false
    database = $null
    contract_version = $null
    post_calls = $false
    get_consultation_card = $false
    cors_preflight_status = $null
    cors_allow_origin = $null
    cors_ready = $false
    frontend_http_status = $null
    frontend_asset = $null
    frontend_has_integrated_calls = $false
    frontend_has_backend_url = $false
    frontend_has_legacy_summarize = $false
    frontend_integrated = $false
    audio_smoke_requested = -not [string]::IsNullOrWhiteSpace($AudioPath)
    audio_smoke_passed = $null
    release_ready = $false
    remaining_actions = @()
}

try {
    $health = Invoke-RestMethod -Uri "$apiBase/health" -Method Get
    $openapi = Invoke-RestMethod -Uri "$apiBase/openapi.json" -Method Get
    $result.database = $health.database
    $result.contract_version = $health.contract_version
    $result.post_calls = [bool]$openapi.paths."/api/v1/calls".post
    $result.get_consultation_card = [bool]$openapi.paths."/api/v1/calls/{call_id}/consultation-card".get
    $result.backend_ready = (
        $health.status -eq "ok" -and
        $health.database -eq "connected" -and
        $health.contract_version -eq "mvp-1.0" -and
        $result.post_calls -and
        $result.get_consultation_card
    )

    $frontendOrigin = ([Uri]$frontendBase).GetLeftPart(
        [System.UriPartial]::Authority
    )
    $preflight = Invoke-WebRequest `
        -Uri "$apiBase/api/v1/calls" `
        -Method Options `
        -Headers @{
            Origin = $frontendOrigin
            "Access-Control-Request-Method" = "POST"
            "Access-Control-Request-Headers" = "content-type"
        } `
        -UseBasicParsing
    $result.cors_preflight_status = [int]$preflight.StatusCode
    $result.cors_allow_origin = $preflight.Headers["Access-Control-Allow-Origin"]
    $result.cors_ready = (
        $result.cors_preflight_status -eq 200 -and
        $result.cors_allow_origin -eq $frontendOrigin
    )
} catch {
    $result.remaining_actions += "Railway backend health/OpenAPI check failed: $($_.Exception.Message)"
}

try {
    $page = Invoke-WebRequest -Uri "$frontendBase/" -UseBasicParsing
    $result.frontend_http_status = [int]$page.StatusCode
    $assetMatch = [regex]::Match(
        $page.Content,
        'assets/index-[^"''>]+\.js',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if (-not $assetMatch.Success) {
        throw "Vite JavaScript asset was not found"
    }

    $assetPath = $assetMatch.Value
    $bundle = (Invoke-WebRequest -Uri "$frontendBase/$assetPath" -UseBasicParsing).Content
    $result.frontend_asset = $assetPath
    $result.frontend_has_integrated_calls = $bundle.Contains("/api/v1/calls")
    $result.frontend_has_backend_url = $bundle.Contains(
        ([Uri]$apiBase).Host
    )
    $result.frontend_has_legacy_summarize = $bundle.Contains("/summarize")
    $result.frontend_integrated = (
        $result.frontend_http_status -eq 200 -and
        $result.frontend_has_integrated_calls -and
        $result.frontend_has_backend_url
    )
} catch {
    $result.remaining_actions += "Vercel deployment bundle check failed: $($_.Exception.Message)"
}

if (-not $result.backend_ready) {
    $result.remaining_actions += "Railway must report database=connected, contract_version=mvp-1.0, and both MVP POST/GET operations"
}

if (-not $result.cors_ready) {
    $result.remaining_actions += "Railway must allow the configured Vercel origin for browser POST requests"
}

if (-not $result.frontend_integrated) {
    $result.remaining_actions += "The Vercel owner must deploy the lch integration with VITE_API_BASE_URL and VITE_USE_REAL_DATA_API=true"
}

if ($result.audio_smoke_requested) {
    try {
        $resolvedAudio = (Resolve-Path -LiteralPath $AudioPath).Path
        & "$PSScriptRoot\smoke-mvp.ps1" -AudioPath $resolvedAudio -ApiBaseUrl $apiBase
        $result.audio_smoke_passed = $true
    } catch {
        $result.audio_smoke_passed = $false
        $result.remaining_actions += "Real-audio POST/GET exact-match smoke failed: $($_.Exception.Message)"
    }
} else {
    $result.remaining_actions += "Run again with -AudioPath after the final deploy to verify exact POST/GET equality"
}

$result.release_ready = (
    $result.backend_ready -and
    $result.cors_ready -and
    $result.frontend_integrated -and
    ($result.audio_smoke_passed -eq $true)
)

$result | ConvertTo-Json -Depth 6

if (-not $result.release_ready) {
    exit 2
}
