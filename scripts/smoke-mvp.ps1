param(
    [Parameter(Mandatory = $true)]
    [string]$AudioPath,

    [string]$ApiBaseUrl = "http://localhost:8000"
)

$ErrorActionPreference = "Stop"
$resolvedAudio = (Resolve-Path -LiteralPath $AudioPath).Path
$baseUrl = $ApiBaseUrl.TrimEnd("/")
$mimeType = switch ([IO.Path]::GetExtension($resolvedAudio).ToLowerInvariant()) {
    ".wav" { "audio/wav" }
    ".mp3" { "audio/mpeg" }
    ".m4a" { "audio/mp4" }
    ".ogg" { "audio/ogg" }
    ".webm" { "audio/webm" }
    default { throw "Unsupported audio extension" }
}

Write-Host "1/3 health check"
$health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
if ($health.status -ne "ok") {
    throw "Health check failed"
}
if ($health.database -ne "connected") {
    throw "Database is not connected: $($health.database)"
}
if ($health.contract_version -ne "mvp-1.0") {
    throw "Unexpected contract version: $($health.contract_version)"
}

$createdBodyPath = [IO.Path]::GetTempFileName()
$storedBodyPath = [IO.Path]::GetTempFileName()

try {
    Write-Host "2/3 upload customer voice"
    $createdStatus = & curl.exe `
        --silent `
        --show-error `
        --output $createdBodyPath `
        --write-out "%{http_code}" `
        --form "audio=@$resolvedAudio;type=$mimeType" `
        "$baseUrl/api/v1/calls"
    if ($LASTEXITCODE -ne 0) {
        throw "Audio upload failed"
    }
    if ([int]$createdStatus -ne 201) {
        throw "Audio upload returned HTTP $createdStatus instead of 201"
    }
    $created = Get-Content -LiteralPath $createdBodyPath -Raw -Encoding UTF8 |
        ConvertFrom-Json

    if ($created.status -ne "ready" -or !$created.call_id) {
        throw "Call creation did not return a ready call_id"
    }
    if ($created.schema_version -ne "mvp-1.0") {
        throw "Create response contract version is not mvp-1.0"
    }
    if ($created.source_channel -ne "voice") {
        throw "Create response source_channel is not voice"
    }
    if ([string]::IsNullOrWhiteSpace($created.transcript.text)) {
        throw "STT transcript is empty"
    }

    Write-Host "3/3 read persisted consultation card"
    $storedStatus = & curl.exe `
        --silent `
        --show-error `
        --output $storedBodyPath `
        --write-out "%{http_code}" `
        "$baseUrl/api/v1/calls/$($created.call_id)/consultation-card"
    if ($LASTEXITCODE -ne 0) {
        throw "Consultation card lookup failed"
    }
    if ([int]$storedStatus -ne 200) {
        throw "Consultation card lookup returned HTTP $storedStatus instead of 200"
    }
    $stored = Get-Content -LiteralPath $storedBodyPath -Raw -Encoding UTF8 |
        ConvertFrom-Json

    $createdCanonical = $created | ConvertTo-Json -Depth 20 -Compress
    $storedCanonical = $stored | ConvertTo-Json -Depth 20 -Compress
    if ($storedCanonical -ne $createdCanonical) {
        throw "GET response does not exactly match the persisted POST response"
    }

    [pscustomobject]@{
        status = "PASS"
        post_http_status = [int]$createdStatus
        get_http_status = [int]$storedStatus
        schema_version = $stored.schema_version
        source_channel = $stored.source_channel
        call_id = $stored.call_id
        transcript = $stored.transcript.text
        summary = $stored.consultation_card.summary
        department = $stored.consultation_card.department
        incident_risk = $stored.consultation_card.incident_risk
        post_get_exact_match = $true
    } | Format-List
} finally {
    Remove-Item -LiteralPath $createdBodyPath, $storedBodyPath -Force -ErrorAction SilentlyContinue
}
