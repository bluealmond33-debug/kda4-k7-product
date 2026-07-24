param(
    [string]$ApiBaseUrl = "https://kda4-k7-backend-production.up.railway.app",
    [string]$FrontendUrl = "https://k7product.vercel.app",
    [string]$AudioPath,
    [string]$CleanupDatabaseUrlEnvironmentVariable = "K7_TEST_DATABASE_URL"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [Console]::OutputEncoding

$apiBase = $ApiBaseUrl.TrimEnd("/")
$frontendBase = $FrontendUrl.TrimEnd("/")
$manifestPath = Join-Path $PSScriptRoot "..\database\active-manifest.json"
$activeManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 |
    ConvertFrom-Json
$expectedContractVersion = [string]$activeManifest.contract_version
$audioSmokeRequested = -not [string]::IsNullOrWhiteSpace($AudioPath)
$result = [ordered]@{
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    api_base_url = $apiBase
    frontend_url = $frontendBase
    backend_ready = $false
    database = $null
    expected_contract_version = $expectedContractVersion
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
    audio_smoke_requested = $audioSmokeRequested
    audio_smoke_passed = $null
    database_contract_verified = $null
    database_rows_restored = $null
    database_row_counts_before = $null
    database_row_counts_after = $null
    release_ready = $false
    remaining_actions = @()
}

function Get-PythonCommand {
    $venvPython = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        return (Resolve-Path -LiteralPath $venvPython).Path
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $pythonCommand) {
        throw "Python is required to verify the active PostgreSQL schema"
    }
    return $pythonCommand.Source
}

function Invoke-DatabaseVerification {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PythonCommand
    )

    $verificationOutput = & $PythonCommand `
        (Join-Path $PSScriptRoot "verify-active-database.py") `
        --database-url-env $CleanupDatabaseUrlEnvironmentVariable
    if ($LASTEXITCODE -ne 0) {
        throw "Active PostgreSQL verification failed"
    }

    $verificationJson = ($verificationOutput | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($verificationJson)) {
        throw "Active PostgreSQL verification returned no result"
    }
    return $verificationJson | ConvertFrom-Json
}

function Test-RowCountsEqual {
    param(
        [Parameter(Mandatory = $true)]
        $Before,

        [Parameter(Mandatory = $true)]
        $After
    )

    foreach ($table in @("calls", "transcripts", "consultation_cards")) {
        if ([long]$Before.$table -ne [long]$After.$table) {
            return $false
        }
    }
    return $true
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
        $health.contract_version -eq $expectedContractVersion -and
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
    $result.remaining_actions += (
        "Railway must report database=connected, contract_version=" +
        "$expectedContractVersion, and both MVP POST/GET operations"
    )
}

if (-not $result.cors_ready) {
    $result.remaining_actions += "Railway must allow the configured Vercel origin for browser POST requests"
}

if (-not $result.frontend_integrated) {
    $result.remaining_actions += "The Vercel owner must deploy the lch integration with VITE_API_BASE_URL and VITE_USE_REAL_DATA_API=true"
}

if ($result.audio_smoke_requested) {
    $databaseUrl = [Environment]::GetEnvironmentVariable(
        $CleanupDatabaseUrlEnvironmentVariable
    )
    if (-not $databaseUrl) {
        $result.audio_smoke_passed = $false
        $result.database_contract_verified = $false
        $result.database_rows_restored = $false
        $result.remaining_actions += (
            "Set $CleanupDatabaseUrlEnvironmentVariable so the release gate " +
            "can verify PostgreSQL and remove the smoke-test call"
        )
    }

    $python = $null
    if ($databaseUrl) {
        try {
            $python = Get-PythonCommand
            $databaseBefore = Invoke-DatabaseVerification -PythonCommand $python
            $result.database_contract_verified = $true
            $result.database_row_counts_before = $databaseBefore.row_counts
        } catch {
            $result.database_contract_verified = $false
            $result.database_rows_restored = $false
            $result.remaining_actions += (
                "Pre-smoke PostgreSQL contract verification failed: " +
                "$($_.Exception.Message)"
            )
        }
    }

    try {
        if (-not $databaseUrl) {
            throw "$CleanupDatabaseUrlEnvironmentVariable is missing"
        }
        if ($result.database_contract_verified -ne $true) {
            throw "Pre-smoke PostgreSQL contract verification did not pass"
        }

        $resolvedAudio = (Resolve-Path -LiteralPath $AudioPath).Path
        & "$PSScriptRoot\smoke-mvp.ps1" `
            -AudioPath $resolvedAudio `
            -ApiBaseUrl $apiBase `
            -CleanupDatabaseUrlEnvironmentVariable $CleanupDatabaseUrlEnvironmentVariable `
            -RequireCleanup
        $result.audio_smoke_passed = $true
    } catch {
        $result.audio_smoke_passed = $false
        $result.remaining_actions += "Real-audio POST/GET exact-match smoke failed: $($_.Exception.Message)"
    }

    if ($databaseUrl -and $python -and $result.database_contract_verified) {
        try {
            $databaseAfter = Invoke-DatabaseVerification -PythonCommand $python
            $result.database_row_counts_after = $databaseAfter.row_counts
            $result.database_rows_restored = Test-RowCountsEqual `
                -Before $result.database_row_counts_before `
                -After $result.database_row_counts_after
            if (-not $result.database_rows_restored) {
                $result.remaining_actions += (
                    "Smoke-test cleanup did not restore the original PostgreSQL " +
                    "row counts"
                )
            }
        } catch {
            $result.database_rows_restored = $false
            $result.remaining_actions += (
                "Post-smoke PostgreSQL verification failed: " +
                "$($_.Exception.Message)"
            )
        }
    }
} else {
    $result.remaining_actions += "Run again with -AudioPath after the final deploy to verify exact POST/GET equality"
}

$result.release_ready = (
    $result.backend_ready -and
    $result.cors_ready -and
    $result.frontend_integrated -and
    ($result.audio_smoke_passed -eq $true) -and
    ($result.database_contract_verified -eq $true) -and
    ($result.database_rows_restored -eq $true)
)

$result | ConvertTo-Json -Depth 6

if (-not $result.release_ready) {
    exit 2
}
