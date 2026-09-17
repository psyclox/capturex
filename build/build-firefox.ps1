param(
    [string]$Version = "",
    [switch]$NoBump
)

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$FFDir = Join-Path $Root "firefox"
$BuildDir = Join-Path $Root "build"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

. (Join-Path $PSScriptRoot "version-manager.ps1")

$VersionJsonPath = Join-Path $Root "version.json"
$currentVer = "1.4"
if (Test-Path $VersionJsonPath) {
    $vData = Get-Content $VersionJsonPath -Raw | ConvertFrom-Json
    if ($vData.version) { $currentVer = $vData.version }
}

if ($Version) {
    $targetVer = $Version.TrimStart('v', 'V')
} elseif ($NoBump) {
    $targetVer = $currentVer
} else {
    $targetVer = $currentVer
}

Update-ProjectVersion -Version $targetVer | Out-Null

Write-Host "CaptureX Firefox Build v$targetVer" -ForegroundColor Cyan

$XpiPath = Join-Path $BuildDir "capturex-firefox-v$targetVer.xpi"
if (Test-Path $XpiPath) { Remove-Item $XpiPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open($XpiPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $files = Get-ChildItem -Path $FFDir -Recurse -File
    foreach ($file in $files) {
        $relPath = $file.FullName.Substring($FFDir.Length).TrimStart('\', '/')
        # Crucial for WebExtensions: XPI/ZIP entries MUST use forward slashes!
        $entryName = $relPath.Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $archive.Dispose()
}

Write-Host "XPI ready: $XpiPath" -ForegroundColor Green
Write-Host "Testing: Load temporary add-on from about:debugging using $FFDir\manifest.json"
Write-Host "AMO upload: Use the XPI file at $XpiPath"
Write-Host "Build complete for Firefox v$targetVer!" -ForegroundColor Green