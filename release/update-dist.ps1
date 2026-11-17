# Keeps dist\ - a Proteus folder that runs as it is, for trying the current state of
# this working tree - up to date.
#
#   dist\Proteus.lnk          double-click to open Proteus (or "Start Proteus.cmd")
#   dist\kernel\              the newest Windows kernel found under out\win<N>\
#   dist\manager\             the manager, as it is in this working tree
#   dist\skill\proteus\       the skill that teaches an AI assistant to drive Proteus
#   dist\VERSION.txt          what the folder was made from, and when
#
# dist\ is not committed (it holds a 400 MB browser). It uses the Node.js installed on
# this computer, and your real Proteus data (%APPDATA%\Proteus): profiles made while
# trying it stay.
#
# usage: update-dist.ps1 [-Kernel <folder with chrome.exe>] [-DesktopShortcut] [-Quiet]
#   -Kernel            use this kernel instead of the newest out\win<N>
#   -DesktopShortcut   also put a Proteus shortcut on the desktop
#   -Quiet             print only problems (for the commit hook)
#
# To have it run after every commit:  release\update-dist.ps1 -InstallHook
param([string]$Kernel = '', [switch]$DesktopShortcut, [switch]$Quiet, [switch]$InstallHook)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$dist = Join-Path $repo 'dist'
function Say([string]$text) { if (-not $Quiet) { Write-Host $text } }

if ($InstallHook) {
  $hook = Join-Path $repo '.git\hooks\post-commit'
  # Git runs hooks with its own shell; forward slashes work there and in PowerShell.
  $line = 'powershell -NoProfile -ExecutionPolicy Bypass -File release/update-dist.ps1 -Quiet || true'
  if ((Test-Path $hook) -and ((Get-Content $hook -Raw) -notmatch 'update-dist\.ps1')) {
    Add-Content -Path $hook -Value $line -Encoding ascii
  } elseif (-not (Test-Path $hook)) {
    [IO.File]::WriteAllText($hook, "#!/bin/sh`n# Keeps dist\ current (release/update-dist.ps1).`n$line`n")
  }
  Say "dist\ will be updated after every commit."
}

# Mirrors a folder. robocopy's exit codes below 8 mean success.
function Mirror([string]$from, [string]$to) {
  robocopy $from $to /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
  return $LASTEXITCODE -lt 8
}

# --- The kernel: the highest-numbered out\win<N> that holds a browser.
if (-not $Kernel) {
  $newest = Get-ChildItem (Join-Path $repo 'out') -Directory -Filter 'win*' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^win(\d+)$' -and (Test-Path (Join-Path $_.FullName 'chrome.exe')) } |
      Sort-Object { [int]($_.Name -replace '\D') } | Select-Object -Last 1
  if ($newest) { $Kernel = $newest.FullName }
}
New-Item -ItemType Directory -Force $dist | Out-Null
$kernelNote = 'none: no kernel was found under out\win<N>; pass -Kernel'
if ($Kernel) {
  if (-not (Test-Path (Join-Path $Kernel 'chrome.exe'))) { throw "There is no chrome.exe in $Kernel" }
  $kernelNote = Split-Path $Kernel -Leaf
  if (-not (Mirror $Kernel (Join-Path $dist 'kernel'))) {
    # The usual reason: Proteus from dist\ is running and its files are in use.
    $kernelNote += ' (NOT fully copied: close Proteus and run update-dist.ps1 again)'
    Write-Warning 'The kernel in dist\ could not be replaced completely. Close Proteus and run this again.'
  }
}

# --- The manager, the launcher, the icon, the skill.
New-Item -ItemType Directory -Force (Join-Path $dist 'manager') | Out-Null
foreach ($part in 'src', 'ui') {
  if (-not (Mirror (Join-Path $repo "manager\$part") (Join-Path $dist "manager\$part"))) { throw "copying manager\$part failed" }
}
Copy-Item (Join-Path $repo 'manager\package.json') (Join-Path $dist 'manager\package.json') -Force
Copy-Item (Join-Path $repo 'release\Start Proteus.cmd') (Join-Path $dist 'Start Proteus.cmd') -Force
Copy-Item (Join-Path $repo 'branding\proteus.ico') (Join-Path $dist 'proteus.ico') -Force
if (-not (Mirror (Join-Path $repo '.claude\skills\proteus') (Join-Path $dist 'skill\proteus'))) { throw 'copying the skill failed' }

# --- Shortcuts: the Proteus icon, and a console that stays out of the way.
function New-ProteusShortcut([string]$path) {
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $shortcut.TargetPath = Join-Path $dist 'Start Proteus.cmd'
  $shortcut.WorkingDirectory = $dist
  $shortcut.IconLocation = (Join-Path $dist 'proteus.ico')
  $shortcut.WindowStyle = 7          # Minimised: the Proteus window is what one sees.
  $shortcut.Description = 'Proteus'
  $shortcut.Save()
}
New-ProteusShortcut (Join-Path $dist 'Proteus.lnk')
if ($DesktopShortcut) {
  New-ProteusShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Proteus.lnk')
  Say 'A Proteus shortcut is on the desktop.'
}

$commit = (git -C $repo log -1 --format='%h %s' 2>$null)
$dirty = if (git -C $repo status --porcelain -- manager release 2>$null) { ' + uncommitted changes' } else { '' }
@(
  "Proteus, from this working tree",
  "updated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
  "source:  $commit$dirty",
  "kernel:  $kernelNote"
) | Set-Content -Path (Join-Path $dist 'VERSION.txt') -Encoding utf8
Say "dist\ is up to date (kernel: $kernelNote). Open dist\Proteus.lnk."
