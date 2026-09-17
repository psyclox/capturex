param(
    [string]$Version = "",
    [switch]$Bump,
    [switch]$NoBump
)

$Root = $PSScriptRoot
. (Join-Path $Root "build\version-manager.ps1")

$VersionJsonPath = Join-Path $Root "version.json"
$currentVer = "1.4"
if (Test-Path $VersionJsonPath) {
    $vData = Get-Content $VersionJsonPath -Raw | ConvertFrom-Json
    if ($vData.version) { $currentVer = $vData.version }
}

if ($Version) {
    $targetVer = $Version.TrimStart('v', 'V')
} elseif ($Bump) {
    $targetVer = Get-NextVersion $currentVer
} else {
    $targetVer = $currentVer
}

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  CaptureX Unified Build System" -ForegroundColor Magenta
Write-Host "  Target Version: v$targetVer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Magenta

Update-ProjectVersion -Version $targetVer | Out-Null

# Build Chrome
& (Join-Path $Root "build\build-chrome.ps1") -Version $targetVer -NoBump

# Build Firefox
& (Join-Path $Root "build\build-firefox.ps1") -Version $targetVer -NoBump

Write-Host "========================================" -ForegroundColor Green
Write-Host "  All Builds Successful for v$targetVer!" -ForegroundColor Green
Write-Host "  Chrome ZIP:  build\capturex-chrome-v$targetVer.zip" -ForegroundColor Yellow
Write-Host "  Firefox XPI: build\capturex-firefox-v$targetVer.xpi" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Green
