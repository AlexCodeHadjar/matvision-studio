param([switch]$DebugBuild, [switch]$NoBundle, [string]$ToolchainRoot = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'native-env.ps1') -ToolchainRoot $ToolchainRoot
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $arguments = @('tauri', 'build')
  if ($DebugBuild) { $arguments += '--debug' }
  if ($NoBundle) { $arguments += '--no-bundle' }
  & pnpm @arguments
  if ($LASTEXITCODE -ne 0) { throw "Native build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
