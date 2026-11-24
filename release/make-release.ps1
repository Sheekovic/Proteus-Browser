# Makes the release bundles from this working tree with one command.
#
# Sends the kernel sources, the manager and the release files to the build server and
# starts server-release.sh there: Linux kernel and all its tests, patch series, Windows
# kernel, bundles. That takes from half an hour (nothing in the kernel changed) to
# several hours (a full rebuild); the run continues on the server if this window is
# closed.
#
# usage: make-release.ps1 <version> [-Message <text>] [-Jobs <n>] [-NoWait] [-Official]
#        make-release.ps1 <version> -Fetch        only fetch the results of a finished run
#   <version>  the bundle version, e.g. 0.1.0-preview.4
#   -Message   what changed in the kernel, for its commit; needed only when the kernel
#              sources differ from what the server has committed
#   -NoWait    start the run and return; fetch its results later with -Fetch
#   -Official  bundles with the optimised kernels, built after the tests in folders of
#              their own: many more hours when the kernel changed
#
# Results: out\release-<version>\ (the bundles and SHA256SUMS.txt) and kernel\patches\
# (the patch series the bundles were built from). Nothing is published: uploading a
# release is a separate, deliberate step.
param(
  [Parameter(Mandatory)][string]$Version,
  [string]$Message = '',
  [int]$Jobs = 8,
  [switch]$NoWait,
  [switch]$Official,
  [switch]$Fetch
)
$ErrorActionPreference = 'Stop'
# The build server, as user@host, from the environment: it is not something to keep
# in a repository.
$h = $env:PROTEUS_BUILD_HOST
if (-not $h) { throw 'Set PROTEUS_BUILD_HOST to the build server (user@host).' }
if ($Version -notmatch '^[0-9A-Za-z.\-]+$') { throw 'The version may hold letters, digits, dots and dashes.' }
if ($Message -match "['`"\\]") { throw 'Leave quotes and backslashes out of the message.' }
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$ssh = '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'

function Invoke-Remote([string]$Command) {
  $output = ssh @ssh $h $Command
  if ($LASTEXITCODE -ne 0) { throw "the build server refused: $Command" }
  $output
}

if (-not $Fetch) {
  # Remote commands carry no double quotes: Windows PowerShell drops them on the way.
  # The brackets keep the search from finding its own command line.
  if ((Invoke-Remote "pgrep -f 'server-[r]elease|server-[t]est|server-[b]uild' > /dev/null && echo busy || echo free") -eq 'busy') {
    throw 'The build server is in the middle of another build or test run.'
  }
  # Two archives: the kernel, laid out as the test runs expect it, and what the
  # bundles are assembled from.
  $kernelTar = Join-Path $env:TEMP 'proteus-stage.tar'
  $bundleTar = Join-Path $env:TEMP 'proteus-release-stage.tar'
  Remove-Item $kernelTar, $bundleTar -ErrorAction SilentlyContinue
  tar -cf $kernelTar -C "$repo\kernel" src tests -C "$repo\kernel\scripts" edits
  if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
  tar -cf $bundleTar -C $repo --exclude 'manager/test' manager release LICENSE branding/proteus.ico
  if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
  scp @ssh -q $kernelTar "${h}:/opt/proteus/stage.tar"
  if ($LASTEXITCODE -ne 0) { throw 'upload failed' }
  scp @ssh -q $bundleTar "${h}:/opt/proteus/release-stage.tar"
  if ($LASTEXITCODE -ne 0) { throw 'upload failed' }
  foreach ($script in 'kernel\scripts\server-test.sh', 'kernel\scripts\server-build.sh', 'release\server-release.sh') {
    scp @ssh -q "$repo\$script" "${h}:/opt/proteus/"
    if ($LASTEXITCODE -ne 0) { throw "upload of $script failed" }
  }
  Invoke-Remote ("cd /opt/proteus && rm -rf stage release-stage && mkdir stage release-stage && " +
      "tar -xf stage.tar -C stage && tar -xf release-stage.tar -C release-stage && " +
      "sed -i 's/\r`$//' server-test.sh server-build.sh server-release.sh && chmod +x server-*.sh && rm -f release.done && " +
      "(nohup setsid ./server-release.sh '$Version' $Jobs '$Message' $(if ($Official) { 'official' }) > release.log 2>&1 < /dev/null &) ; echo started") | Out-Null
  Write-Host "Release $Version started on the build server."
  if ($NoWait) {
    Write-Host "Fetch the results when it has finished:  make-release.ps1 $Version -Fetch"
    return
  }
  $shown = 0
  while ($true) {
    Start-Sleep -Seconds 60
    $lines = @(ssh @ssh $h "grep -a '^== \|RELEASE-OK\| ok=\|^FAIL\|no release' /opt/proteus/release.log; test -f /opt/proteus/release.done && echo exit=`$(cat /opt/proteus/release.done)")
    if ($lines.Count -gt $shown) { $lines[$shown..($lines.Count - 1)] | ForEach-Object { Write-Host $_ }; $shown = $lines.Count }
    if ($lines -match '^exit=') { break }
  }
}

$code = (Invoke-Remote 'cat /opt/proteus/release.done 2>/dev/null || echo running') | Select-Object -Last 1
if ($code -eq 'running') { throw 'The run has not finished yet.' }
if ($code -ne '0') {
  ssh @ssh $h 'tail -n 40 /opt/proteus/release.log'
  throw "The release run failed (exit $code); the end of its log is above."
}
if (-not (Invoke-Remote "ls /opt/proteus/release-out | grep -F -- 'Proteus-$Version-' || true")) {
  throw "The finished run on the server was not for version $Version."
}

$out = Join-Path $repo "out\release-$Version"
New-Item -ItemType Directory -Force $out | Out-Null
scp @ssh -q "${h}:/opt/proteus/release-out/Proteus-$Version-*" "${h}:/opt/proteus/release-out/SHA256SUMS.txt" $out
if ($LASTEXITCODE -ne 0) { throw 'download of the bundles failed' }
# What arrived is what was built.
foreach ($line in Get-Content (Join-Path $out 'SHA256SUMS.txt')) {
  $sum, $name = $line -split '\s+', 2
  $actual = (Get-FileHash (Join-Path $out $name.Trim()) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $sum) { throw "checksum mismatch: $name" }
}
$patches = Join-Path $env:TEMP 'proteus-patches.tar'
scp @ssh -q "${h}:/opt/proteus/patches.tar" $patches
if ($LASTEXITCODE -ne 0) { throw 'download of the patch series failed' }
Remove-Item "$repo\kernel\patches\*.patch", "$repo\kernel\patches\boringssl\*.patch" -ErrorAction SilentlyContinue
tar -xf $patches -C "$repo\kernel\patches"
Write-Host "Bundles: $out"
Get-ChildItem $out | ForEach-Object { Write-Host ("  {0}  {1:N0} MB" -f $_.Name, ($_.Length / 1MB)) }
Write-Host "Patch series: kernel\patches ($((Get-ChildItem "$repo\kernel\patches\*.patch").Count) patches, and $((Get-ChildItem "$repo\kernel\patches\boringssl\*.patch").Count) for BoringSSL)"
