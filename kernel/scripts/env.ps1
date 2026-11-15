# Dot-source this to get a shell that can run gclient / gn / autoninja for Proteus.
$script:Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = '0'   # use the locally installed Visual Studio
$env:DEPOT_TOOLS_UPDATE = '0'          # keep depot_tools at the cloned revision
$env:PATH = "$script:Root\depot_tools;$env:PATH"
$ProteusRoot = $script:Root
$ChromiumVersion = (Get-Content "$script:Root\kernel\CHROMIUM_VERSION" -Raw).Trim()
