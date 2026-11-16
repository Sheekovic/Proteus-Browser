# Runs Proteus test pages in a locally installed Kameleo, for comparing how the two
# browsers answer the same questions (see kernel/tests/detect.html).
#
# Uses Kameleo's own local API (it must be running, on port 5050): creates a temporary
# profile, starts it, opens the pages through its DevTools endpoint, then stops and
# deletes the profile again. Existing profiles are not touched.
#
# usage: compare-kameleo.ps1 -Pages detect.html[,other.html] [-Os windows]
#                            [-Extra '{"canvas":"noise","webgl":"noise","audio":"noise"}']
# The test pages are served from kernel/tests for the duration of the run.
param(
    [string]$Os = 'windows',
    # 'desktop' or 'mobile' (with -Os android or ios).
    [string]$DeviceType = 'desktop',
    # Browser the fingerprint is of: chrome, safari, ...
    [string]$Browser = 'chrome',
    [Parameter(Mandatory)][string[]]$Pages,
    [string]$Extra = '{}',
    [int]$Port = 8792,
    # Treat -Pages as names of public detection sites (kernel/tests/probe-sites.mjs), or "all".
    [switch]$Sites
)
$ErrorActionPreference = 'Stop'
$Pages = @($Pages | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$api = 'http://localhost:5050'
$tests = (Resolve-Path "$PSScriptRoot\..\tests").Path

$server = Start-Process python -ArgumentList "`"$tests\serve.py`"", "`"$tests`"", $Port -PassThru -WindowStyle Hidden
$id = $null
try {
    $fingerprints = Invoke-RestMethod -TimeoutSec 30 "$api/fingerprints?deviceType=$DeviceType&browserProduct=$Browser&osFamily=$Os"
    $fp = @($fingerprints)[0]
    "fingerprint: $($fp.os.family) $($fp.os.version) / chrome $($fp.browser.major) / $($fp.webglMeta.renderer)"

    $body = @{ fingerprintId = $fp.id; name = "proteus-compare-$Os" }
    ($Extra | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $body[$_.Name] = $_.Value }
    $profile = Invoke-RestMethod -TimeoutSec 30 -Method Post -ContentType 'application/json' `
        -Body ($body | ConvertTo-Json -Depth 6) "$api/profiles/new"
    $id = $profile.id
    "profile: canvas=$($profile.canvas) webgl=$($profile.webgl) audio=$($profile.audio)"

    Invoke-RestMethod -TimeoutSec 120 -Method Post -ContentType 'application/json' -Body '{}' "$api/profiles/$id/start" | Out-Null
    $debugPort = $null
    foreach ($i in 1..40) {
        $proc = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
            Where-Object { $_.CommandLine -like "*$id*" -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
        if ($proc) { $debugPort = [regex]::Match($proc.CommandLine, '--remote-debugging-port=(\d+)').Groups[1].Value }
        if ($debugPort) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $debugPort) { throw 'could not find the profile browser process' }
    $ws = (Invoke-RestMethod -TimeoutSec 10 "http://127.0.0.1:$debugPort/json/version").webSocketDebuggerUrl
    if ($Sites) {
        $names = @($Pages | Where-Object { $_ -ne 'all' })
        node "$tests\probe-sites.mjs" $ws @names
    } else {
        node "$tests\probe-browser.mjs" $ws "http://127.0.0.1:$Port" @Pages
    }
}
finally {
    if ($id) {
        try { Invoke-RestMethod -TimeoutSec 60 -Method Post -ContentType 'application/json' -Body '{}' "$api/profiles/$id/stop" | Out-Null } catch { "stop: $($_.Exception.Message)" }
        Start-Sleep -Seconds 2
        try { Invoke-RestMethod -TimeoutSec 60 -Method Delete "$api/profiles/$id" | Out-Null; 'temporary profile deleted' } catch { "DELETE FAILED for $id : $($_.Exception.Message)" }
    }
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}
