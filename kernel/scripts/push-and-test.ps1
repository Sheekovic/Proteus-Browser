# Sends the Proteus kernel sources, edit scripts and tests to the build server as one
# archive and starts a rebuild-and-test run there. Returns immediately; the run writes
# /opt/proteus/test-<name>.log and, when finished, /opt/proteus/test-<name>.done.
# usage: push-and-test.ps1 <test-name> [jobs]
param([Parameter(Mandatory)][string]$Name, [int]$Jobs = 4)
$ErrorActionPreference = 'Stop'
# The build server, as user@host, from the environment: it is not something to keep
# in a repository.
$h = $env:PROTEUS_BUILD_HOST
if (-not $h) { throw 'Set PROTEUS_BUILD_HOST to the build server (user@host).' }
$kernel = (Resolve-Path "$PSScriptRoot\..").Path
$ssh = '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'

$tar = Join-Path $env:TEMP 'proteus-stage.tar'
if (Test-Path $tar) { Remove-Item $tar }
# Archive layout: src/..., tests/..., edits/...
tar -cf $tar -C $kernel src tests -C "$kernel\scripts" edits
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

scp @ssh -q $tar "${h}:/opt/proteus/stage.tar"
if ($LASTEXITCODE -ne 0) { throw 'upload of stage.tar failed' }
scp @ssh -q "$kernel\scripts\server-test.sh" "${h}:/opt/proteus/server-test.sh"
if ($LASTEXITCODE -ne 0) { throw 'upload of server-test.sh failed' }

$remote = "cd /opt/proteus && rm -rf stage && mkdir stage && tar -xf stage.tar -C stage && " +
    "sed -i 's/\r`$//' server-test.sh && chmod +x server-test.sh && rm -f test-$Name.done && " +
    "(nohup setsid ./server-test.sh $Name $Jobs > test-$Name.log 2>&1 < /dev/null &) ; " +
    "echo started; find stage -type f | wc -l"
ssh @ssh $h $remote
