# Fetches the pinned Chromium release (no git history) into <repo>/chromium/src
# and runs the hooks that download the clang toolchain and other build deps.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\env.ps1"

$work = "$ProteusRoot\chromium"
New-Item -ItemType Directory -Force $work | Out-Null

@'
solutions = [
  {
    "name": "src",
    "url": "https://chromium.googlesource.com/chromium/src.git",
    "managed": False,
    "custom_deps": {},
    "custom_vars": {},
  },
]
'@ | Set-Content -Encoding ascii "$work\.gclient"

Push-Location $work
try {
    Write-Host "Syncing Chromium $ChromiumVersion ..."
    gclient sync --no-history --delete_unversioned_trees --reset `
        --revision "src@refs/tags/$ChromiumVersion"
    if ($LASTEXITCODE -ne 0) { throw "gclient sync failed with exit code $LASTEXITCODE" }
    Write-Host "FETCH-OK $ChromiumVersion"
}
finally { Pop-Location }
