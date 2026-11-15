# Sends the manager and the kernel test pages to the build server and starts the
# end-to-end run there. Returns immediately; the run writes /opt/proteus/e2e.log and,
# when finished, /opt/proteus/e2e.done.
$ErrorActionPreference = 'Stop'
$h = 'user@build-host'
$repo = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$ssh = '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'

$tar = Join-Path $env:TEMP 'proteus-manager-stage.tar'
if (Test-Path $tar) { Remove-Item $tar }
tar -cf $tar -C $repo manager -C "$repo\kernel" tests
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

scp @ssh -q $tar "${h}:/opt/proteus/manager-stage.tar"
if ($LASTEXITCODE -ne 0) { throw 'upload failed' }

$remote = "cd /opt/proteus && rm -rf manager-stage && mkdir manager-stage && " +
    "tar -xf manager-stage.tar -C manager-stage && " +
    "sed -i 's/\r`$//' manager-stage/manager/test/e2e/server-run.sh && rm -f e2e.done && " +
    "(nohup setsid bash manager-stage/manager/test/e2e/server-run.sh > e2e.log 2>&1 < /dev/null &) ; echo started"
ssh @ssh $h $remote
