param(
    [Parameter(Mandatory = $true)]
    [string]$AudioPath,

    [string]$ApiBaseUrl = "http://localhost:8000"
)

$ErrorActionPreference = "Stop"
$resolvedAudio = (Resolve-Path -LiteralPath $AudioPath).Path
$baseUrl = $ApiBaseUrl.TrimEnd("/")

Write-Host "1/3 health check"
$health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
if ($health.status -ne "ok") {
    throw "Health check failed"
}

Write-Host "2/3 upload customer voice"
$createdJson = & curl.exe `
    --silent `
    --show-error `
    --fail `
    --form "audio=@$resolvedAudio" `
    "$baseUrl/api/v1/calls"
if ($LASTEXITCODE -ne 0) {
    throw "Audio upload failed"
}
$created = $createdJson | ConvertFrom-Json

if ($created.status -ne "ready" -or !$created.call_id) {
    throw "Call creation did not return a ready call_id"
}

Write-Host "3/3 read persisted consultation card"
$stored = Invoke-RestMethod `
    -Uri "$baseUrl/api/v1/calls/$($created.call_id)/consultation-card" `
    -Method Get

if ($stored.call_id -ne $created.call_id) {
    throw "Stored call_id does not match created call_id"
}
if ($stored.consultation_card.summary -ne $created.consultation_card.summary) {
    throw "Stored consultation card does not match the create response"
}

[pscustomobject]@{
    status = "PASS"
    call_id = $stored.call_id
    transcript = $stored.transcript.text
    summary = $stored.consultation_card.summary
    department = $stored.consultation_card.department
    incident_risk = $stored.consultation_card.incident_risk
} | Format-List
