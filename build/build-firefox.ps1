param([string]$Version = "1.0.0")
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$FFDir = Join-Path $Root "firefox"
$BuildDir = Join-Path $Root "build"
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
Write-Host "CaptureX Firefox Build v$Version" -ForegroundColor Cyan

$ManifestPath = Join-Path $FFDir "manifest.json"
$m = Get-Content $ManifestPath | ConvertFrom-Json
$m.version = $Version
$m | ConvertTo-Json -Depth 10 | Set-Content $ManifestPath
Write-Host "Version updated to $Version"

$XpiPath = Join-Path $BuildDir "capturex-firefox-v$Version.xpi"
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
Write-Host "Build complete!" -ForegroundColor Green