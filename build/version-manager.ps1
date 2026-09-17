# CaptureX Version Manager
# Rule: 5 sub-versions per main version (v1.0 -> v1.5 then v2.0 -> v2.5)

function Get-NextVersion([string]$currentVer) {
    $clean = $currentVer.TrimStart('v', 'V').Trim()
    $parts = $clean.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]

    if ($minor -ge 5) {
        $major = $major + 1
        $minor = 0
    } else {
        $minor = $minor + 1
    }
    return "$major.$minor"
}

function Update-ProjectVersion([string]$Version) {
    $Root = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path (Join-Path $Root "chrome"))) {
        $Root = $PSScriptRoot
    }

    $cleanVer = $Version.TrimStart('v', 'V').Trim()
    Write-Host "Syncing project to version v$cleanVer..." -ForegroundColor Cyan

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    # 1. Update version.json
    $VersionJsonPath = Join-Path $Root "version.json"
    $vObj = @{ version = $cleanVer }
    [System.IO.File]::WriteAllText($VersionJsonPath, ($vObj | ConvertTo-Json), $utf8NoBom)

    # 2. Update Chrome manifest.json using exact regex replace
    $ChromeManifest = Join-Path $Root "chrome\manifest.json"
    if (Test-Path $ChromeManifest) {
        $cm = [System.IO.File]::ReadAllText($ChromeManifest, [System.Text.Encoding]::UTF8)
        $cmUpdated = [regex]::Replace($cm, '"version":\s*"[^"]+"', "`"version`": `"$cleanVer`"")
        [System.IO.File]::WriteAllText($ChromeManifest, $cmUpdated, $utf8NoBom)
    }

    # 3. Update Firefox manifest.json using exact regex replace
    $FFManifest = Join-Path $Root "firefox\manifest.json"
    if (Test-Path $FFManifest) {
        $fm = [System.IO.File]::ReadAllText($FFManifest, [System.Text.Encoding]::UTF8)
        $fmUpdated = [regex]::Replace($fm, '"version":\s*"[^"]+"', "`"version`": `"$cleanVer`"")
        [System.IO.File]::WriteAllText($FFManifest, $fmUpdated, $utf8NoBom)
    }

    # 4. Update popup.html in chrome & firefox
    $popupFiles = @(
        (Join-Path $Root "chrome\popup\popup.html"),
        (Join-Path $Root "firefox\popup\popup.html")
    )
    foreach ($pf in $popupFiles) {
        if (Test-Path $pf) {
            $content = [System.IO.File]::ReadAllText($pf, [System.Text.Encoding]::UTF8)
            $updated = [regex]::Replace($content, '<span class="logo-version">v[^<]+</span>', "<span class=`"logo-version`">v$cleanVer</span>")
            [System.IO.File]::WriteAllText($pf, $updated, $utf8NoBom)
        }
    }

    # 5. Update README.md
    $ReadmePath = Join-Path $Root "README.md"
    if (Test-Path $ReadmePath) {
        $readme = [System.IO.File]::ReadAllText($ReadmePath, [System.Text.Encoding]::UTF8)
        $readme = [regex]::Replace($readme, '<h1>CaptureX v[^<]+</h1>', "<h1>CaptureX v$cleanVer</h1>")
        $readme = [regex]::Replace($readme, '<b>CaptureX v[^<]+</b>', "<b>CaptureX v$cleanVer</b>")
        $readme = [regex]::Replace($readme, 'capturex-chrome-v[0-9\.]+\.zip', "capturex-chrome-v$cleanVer.zip")
        $readme = [regex]::Replace($readme, 'capturex-firefox-v[0-9\.]+\.xpi', "capturex-firefox-v$cleanVer.xpi")
        [System.IO.File]::WriteAllText($ReadmePath, $readme, $utf8NoBom)
    }

    Write-Host "All version files updated to v$cleanVer." -ForegroundColor Green
    return $cleanVer
}
