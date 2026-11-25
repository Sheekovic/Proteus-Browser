# Installs the Proteus in this folder for the person running it: a copy under their
# own programs folder, a shortcut in the Start menu and on the desktop, and an entry
# in "Installed apps" to remove it again. Nothing needs administrator rights and
# nothing outside the user's own account is touched. Profiles and settings are not in
# the program folder (they are in %APPDATA%\Proteus), so installing a newer version
# over an older one, or removing Proteus, leaves them as they are.
#
# usage: install.ps1 [-Uninstall] [-NoDesktop] [-Quiet]
#   -Uninstall   remove what an install made (the program, its shortcuts, its entry)
#   -NoDesktop   no shortcut on the desktop
#   -Quiet       say nothing
# For testing, the places can be given: -Target, -StartMenu, -Desktop <folder>, and
# -NoRegister leaves the list of installed apps alone.
param(
  [switch]$Uninstall, [switch]$NoDesktop, [switch]$Quiet, [switch]$NoRegister,
  [string]$Target = (Join-Path $env:LOCALAPPDATA 'Programs\Proteus'),
  [string]$StartMenu = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [string]$Desktop = [Environment]::GetFolderPath('Desktop')
)
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Proteus'
$shortcuts = @((Join-Path $StartMenu 'Proteus.lnk'), (Join-Path $Desktop 'Proteus.lnk'))

function Say([string]$text) { if (-not $Quiet) { Write-Host $text } }

# A running Proteus keeps its files open: copying over them, or removing them, would
# leave half of each.
function Test-Running([string]$folder) {
  $kernel = Join-Path $folder 'kernel\chrome.exe'
  $node = Join-Path $folder 'node\node.exe'
  [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -eq $kernel -or $_.Path -eq $node) })
}

if ($Uninstall) {
  if (Test-Running $Target) { throw 'Proteus is running. Close it and its profiles first.' }
  foreach ($shortcut in $shortcuts) { if (Test-Path $shortcut) { Remove-Item $shortcut -Force } }
  if (-not $NoRegister -and (Test-Path $registry)) { Remove-Item $registry -Recurse -Force }
  # The start at sign-in that the settings can turn on, when it starts this Proteus.
  $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $atSignIn = (Get-ItemProperty -Path $run -Name Proteus -ErrorAction SilentlyContinue).Proteus
  if (-not $NoRegister -and $atSignIn -and $atSignIn.Contains($Target)) { Remove-ItemProperty -Path $run -Name Proteus }
  # Only a folder an install made is removed: it holds the note the install left.
  if (Test-Path (Join-Path $Target 'installed.txt')) { Remove-Item $Target -Recurse -Force }
  Say 'Proteus was removed. Your profiles and settings are still in %APPDATA%\Proteus.'
  return
}

foreach ($needed in 'manager\src\main.ts', 'kernel\chrome.exe', 'Start Proteus.cmd') {
  if (-not (Test-Path (Join-Path $source $needed))) { throw "This is not a Proteus folder: $needed is missing." }
}
if ((Resolve-Path $source).Path -eq $Target) { throw 'This Proteus is the installed one already.' }
if (Test-Running $Target) { throw 'The installed Proteus is running. Close it and its profiles first.' }

# A folder that is there and is not an earlier install is someone's own: left alone.
if ((Test-Path $Target) -and (Get-ChildItem $Target -Force | Select-Object -First 1) -and
    -not (Test-Path (Join-Path $Target 'installed.txt'))) {
  throw "$Target exists and is not a Proteus that was installed. Nothing was changed."
}
New-Item -ItemType Directory -Force $Target | Out-Null
# robocopy's exit codes below 8 mean success.
robocopy $source $Target /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying to $Target failed (robocopy $LASTEXITCODE)." }
$global:LASTEXITCODE = 0

$version = 'unknown'
$versionFile = Join-Path $Target 'VERSION.txt'
if (Test-Path $versionFile) { $version = (Get-Content $versionFile -TotalCount 1).Trim() }
"Proteus $version, installed $(Get-Date -Format 'yyyy-MM-dd HH:mm') from $source" |
  Set-Content -Path (Join-Path $Target 'installed.txt') -Encoding utf8

$icon = Join-Path $Target 'proteus.ico'
$wanted = @($shortcuts[0])
if (-not $NoDesktop) { $wanted += $shortcuts[1] }
foreach ($path in $wanted) {
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $shortcut.TargetPath = Join-Path $Target 'Start Proteus.cmd'
  $shortcut.WorkingDirectory = $Target
  $shortcut.Description = 'Proteus'
  if (Test-Path $icon) { $shortcut.IconLocation = $icon }
  # The console that shows what Proteus is doing starts out of the way.
  $shortcut.WindowStyle = 7
  $shortcut.Save()
}

if (-not $NoRegister) {
  New-Item -Path $registry -Force | Out-Null
  $remove = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Target 'install.ps1')`" -Uninstall"
  $values = @{
    DisplayName = 'Proteus'; DisplayVersion = $version; Publisher = 'Proteus'; InstallLocation = $Target
    UninstallString = $remove; QuietUninstallString = "$remove -Quiet"; DisplayIcon = $icon
    URLInfoAbout = 'https://github.com/Sheekovic/Proteus-Browser'
  }
  foreach ($name in $values.Keys) { Set-ItemProperty -Path $registry -Name $name -Value $values[$name] }
  Set-ItemProperty -Path $registry -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty -Path $registry -Name NoRepair -Value 1 -Type DWord
}
Say "Proteus $version is installed in $Target. Open it from the Start menu."
