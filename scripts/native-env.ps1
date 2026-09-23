# Dot-source to use the optional workspace-local MSVC/Rust/SDK toolchain.
# A normal machine with Rust + Visual Studio C++ can build directly with pnpm tauri.
param([string]$ToolchainRoot = '')
$ErrorActionPreference = 'Stop'
if (-not $ToolchainRoot) {
  $ToolchainRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../work/toolchain'))
}
$cargoRoot = Join-Path $ToolchainRoot 'cargo'
$rustupRoot = Join-Path $ToolchainRoot 'rustup'
if (-not (Test-Path -LiteralPath (Join-Path $cargoRoot 'bin/cargo.exe'))) {
  throw "Local Rust missing in $ToolchainRoot. Install normal Tauri prerequisites or supply -ToolchainRoot."
}
$env:CARGO_HOME = $cargoRoot
$env:RUSTUP_HOME = $rustupRoot
if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '2' }
$msvcRoot = Join-Path $ToolchainRoot 'msvc/VC/Tools/MSVC/14.50.35717'
$sdkRoot = Join-Path $ToolchainRoot 'sdk'
$sdkVersion = '10.0.28000.0'
$msvcBin = Join-Path $msvcRoot 'bin/Hostx64/x64'
$sdkBin = Join-Path $sdkRoot "bin/$sdkVersion/x64"
$env:PATH = "$(Join-Path $cargoRoot 'bin');$msvcBin;$sdkBin;$env:PATH"
$env:LIB = "$(Join-Path $msvcRoot 'lib/x64');$(Join-Path $msvcRoot 'lib/onecore/x64');$(Join-Path $sdkRoot "um/x64");$(Join-Path $sdkRoot "ucrt/x64")"
$env:INCLUDE = "$(Join-Path $msvcRoot 'include');$(Join-Path $sdkRoot "Include/$sdkVersion/ucrt");$(Join-Path $sdkRoot "Include/$sdkVersion/shared");$(Join-Path $sdkRoot "Include/$sdkVersion/um");$(Join-Path $sdkRoot "Include/$sdkVersion/winrt")"
$env:VCToolsInstallDir = $msvcRoot + '\'
$env:WindowsSdkDir = $sdkRoot + '\'
$env:WindowsSDKVersion = $sdkVersion + '\'
$env:WindowsSDKLibVersion = $sdkVersion + '\'
$env:WindowsSdkVerBinPath = (Join-Path $sdkRoot "bin/$sdkVersion") + '\'
$env:VCINSTALLDIR = (Join-Path $ToolchainRoot 'msvc/VC') + '\'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = Join-Path $msvcBin 'link.exe'
foreach ($required in @((Join-Path $msvcBin 'link.exe'), (Join-Path $sdkBin 'rc.exe'), (Join-Path $sdkRoot "um/x64/kernel32.lib"))) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required local prerequisite missing: $required" }
}
