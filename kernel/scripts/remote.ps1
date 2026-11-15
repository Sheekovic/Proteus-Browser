# Runs a local bash script on the build server.
# usage: remote.ps1 <script.sh> [timeout-less; output is printed]
param([Parameter(Mandatory)][string]$Script)
$h = 'user@build-host'
$name = 'r-' + [IO.Path]::GetFileName($Script)
ssh -o BatchMode=yes $h "mkdir -p /opt/proteus/tmp" | Out-Null
scp -o BatchMode=yes -q $Script "${h}:/opt/proteus/tmp/$name"
ssh -o BatchMode=yes -o ServerAliveInterval=60 $h "sed -i 's/\r$//' /opt/proteus/tmp/$name && bash /opt/proteus/tmp/$name"
