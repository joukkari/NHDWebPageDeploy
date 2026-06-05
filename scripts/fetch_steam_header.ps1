param(
    [string]$AppId = "4166900",
    [string]$OutputPath = "deploy-build\\assets\\steam_header.json"
)

Write-Host "Fetching Steam header_image for app $AppId..." -ForegroundColor Cyan

try {
    $uri = "https://store.steampowered.com/api/appdetails?appids=$AppId"
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -Headers @{ 'Accept' = 'application/json' }
    $json = $resp.Content | ConvertFrom-Json
    $data = $json.$AppId.data
    if (-not $data) { throw "No data for app $AppId" }
    $header = $data.header_image
    if (-not $header) { throw "header_image missing for app $AppId" }

    $outDir = Split-Path -Parent $OutputPath
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    $payload = @{ header_image = $header } | ConvertTo-Json -Compress
    Set-Content -Path $OutputPath -Value $payload -Encoding UTF8
    Write-Host "Wrote $OutputPath" -ForegroundColor Green
}
catch {
    Write-Warning ("Failed to fetch header_image: " + $_.Exception.Message)
    # Do not fail the build; continue without JSON
}
