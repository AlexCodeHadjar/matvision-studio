# Builds the latest MatVision Studio from this branch and puts a launcher on
# the desktop. Run on Windows from the repository (or double-click
# install-desktop.cmd in the repository root).
#
#   .\scripts\install-desktop.ps1            update branch, build, shortcut, launch
#   .\scripts\install-desktop.ps1 -SkipUpdate   build the working tree as it is
param(
  [string]$Branch = 'claude/inspiring-euler-mkaca2',
  [string]$ToolchainRoot = '',
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'MatVisionStudio'),
  [string]$ShortcutName = 'MatVision Studio',
  [switch]$SkipUpdate,
  [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $repo
try {
  if (-not $SkipUpdate) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git не найден. Установите Git или запустите с -SkipUpdate.' }
    if (git status --porcelain) { throw 'В папке есть незакоммиченные изменения. Сохраните их или запустите с -SkipUpdate.' }
    Write-Host "Обновление ветки $Branch..."
    git fetch origin $Branch
    if ($LASTEXITCODE -ne 0) { throw 'git fetch завершился с ошибкой.' }
    git checkout $Branch
    if ($LASTEXITCODE -ne 0) { throw "Не удалось переключиться на $Branch." }
    git pull --ff-only origin $Branch
    if ($LASTEXITCODE -ne 0) { throw 'git pull завершился с ошибкой.' }
  }

  Write-Host 'Установка зависимостей...'
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install завершился с ошибкой.' }

  # Prefer the workspace-local MSVC/Rust toolchain used for earlier releases;
  # otherwise any normal Rust + Visual Studio C++ installation works.
  $localToolchain = if ($ToolchainRoot) { $ToolchainRoot } else {
    [IO.Path]::GetFullPath((Join-Path $repo '../../work/toolchain'))
  }
  Write-Host 'Сборка приложения (несколько минут)...'
  if (Test-Path -LiteralPath (Join-Path $localToolchain 'cargo/bin/cargo.exe')) {
    & (Join-Path $PSScriptRoot 'native-build.ps1') -NoBundle -ToolchainRoot $localToolchain
  } elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
    pnpm tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "Сборка завершилась с кодом $LASTEXITCODE." }
  } else {
    throw 'Не найден Rust. Установите Rust (https://rustup.rs) и Visual Studio Build Tools с компонентом C++ или укажите -ToolchainRoot.'
  }

  $built = Join-Path $repo 'src-tauri/target/release/matvision-studio.exe'
  if (-not (Test-Path -LiteralPath $built)) { throw "Собранный файл не найден: $built" }
  $version = (Get-Content -Raw (Join-Path $repo 'package.json') | ConvertFrom-Json).version
  $destination = Join-Path $InstallDir $version
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  $exe = Join-Path $destination 'MatVisionStudio.exe'
  # A running copy locks the file; ask the user to close it first.
  try { Copy-Item -LiteralPath $built -Destination $exe -Force }
  catch { throw "Не удалось заменить $exe. Закройте MatVision Studio и запустите снова." }
  Copy-Item -LiteralPath (Join-Path $repo 'docs/licenses') -Destination $destination -Recurse -Force

  $desktop = [Environment]::GetFolderPath('Desktop')
  $link = Join-Path $desktop "$ShortcutName.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = $destination
  $shortcut.IconLocation = "$exe,0"
  $shortcut.Description = "MatVision Studio $version"
  $shortcut.Save()

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash
  $commit = if (Get-Command git -ErrorAction SilentlyContinue) { git rev-parse --short HEAD } else { 'unknown' }
  Write-Host ''
  Write-Host "Готово: MatVision Studio $version ($commit)"
  Write-Host "Программа: $exe"
  Write-Host "Ярлык:     $link"
  Write-Host "SHA-256:   $hash"
  if (-not $NoLaunch) { Start-Process -FilePath $exe -WorkingDirectory $destination }
} finally {
  Pop-Location
}
