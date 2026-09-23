# Native toolchain audit

Observed on 2026-09-15.

- Windows x64. Visual Studio Community 18.3.2 IDE is present; the C++ compiler workload and Windows SDK were absent. `vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` returned no installations.
- Rust 1.98.1 stable MSVC installed into the workspace's `work/toolchain/cargo` and `work/toolchain/rustup`. The official rustup installer SHA-256 matched `6f4bef66261261fcb43131be8720bab817d403a09edec7455c371974b90bdb7e`. Installation used `--no-modify-path`.
- MSVC x64 compiler 14.50.35725 and CRT 14.50.35721 are extracted from Microsoft's VSIX archives listed by the existing Visual Studio 18.3.2 catalog. All payload hashes were verified against that catalog. The archives share the toolset directory `14.50.35717`.
- Windows SDK 10.0.28000.2705 CPP + CPP.x64 NuGet packages are extracted locally; contained SDK directories use `10.0.28000.0`.
- No global toolchain or user PATH modification was performed. Only the calling process receives local environment variables.

## Local workspace commands

From the repository in PowerShell:

```powershell
. ./scripts/native-env.ps1
cargo --version
rustc --version
pnpm tauri dev
# For the initial native binary with frontend embedded:
./scripts/native-build.ps1 -DebugBuild -NoBundle
# For production executable and NSIS installer:
./scripts/native-build.ps1
```

The local environment script is a convenience for this constrained build host. On a normal developer machine, install the documented Tauri prerequisites, then use `pnpm install --frozen-lockfile` and `pnpm tauri dev` without the local environment script. No local toolchain binaries belong in the source repository or application installer.

The executable name is `src-tauri/target/release/matvision-studio.exe` (`debug` for a debug build). NSIS output is below `src-tauri/target/release/bundle/nsis`.

## Sources

- [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Official Rust installer and checksums](https://rust-lang.github.io/rustup/installation/other.html)
- [Windows SDK downloads and NuGet distribution](https://learn.microsoft.com/en-us/windows/apps/windows-sdk/downloads)
- [Microsoft Windows SDK CPP x64 package](https://www.nuget.org/packages/Microsoft.Windows.SDK.CPP.x64/10.0.28000.2705)

## Verification status

Portable compiler and SDK extraction completed. A Rust Windows executable compiled, linked, and ran successfully (stdout: `native toolchain works`). `tauri info` detects Rust and WebView2 but cannot detect the unregistered portable MSVC/SDK layout; this discovery warning is expected and is superseded by actual compilation evidence.

The initial `pnpm tauri build --debug --no-bundle` completed successfully, producing `src-tauri/target/debug/matvision-studio.exe` with embedded Vite frontend. Rust compilation took 4m08s after fetching dependencies. `cargo fmt --check` passed. The local environment limits later Cargo builds to two jobs so browser and visual checks can share this host.

The final frozen first-gate scene (corrected geometry, HDR hemisphere, shadow map, and WebGL context restoration) was re-embedded successfully in 6.54s. Its debug executable is 12,922,880 bytes; SHA-256 `728EDAF3FEFD3CFD291B3FE505058181BCDDA39B7423E96AB83A02A7D6170E5A`. A PE import inspection found only Windows system DLL imports; Tauri statically linked the Visual C++ runtime as expected (no `vcruntime140.dll` dependency). WebView2 remains a runtime prerequisite.

`cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` passed in 1m58s with no findings.

Startup, native E2E, and production installer checks must be recorded separately; this audit is not a release PASS. The user explicitly waived clean-machine testing for the current scope on 2026-09-15. Installation, execution, and uninstallation on this host remain required and must not be described as clean-machine verification.

## Native file API

`src/native/index.ts` provides `openNativeImage(path?)`, `openNativeProject(path?)`, `saveNativeProject(contents, path?)`, and `saveNativePng(bytes, path?)`. Omitted paths open parented native dialogs. Cancellation returns `null`; failures reject with a user-readable error. Explicit absolute paths pass through the same production validation and write functions and support automation, Unicode names, and spaces.

The bridge uses `isTauri()` and reports a native-only error when called in a browser. PNG export sends a `Uint8Array` as binary Tauri IPC, with its optional UTF-8 path encoded in an ASCII request header. It avoids expanding image bytes into a JSON array. Commands verify the main window and packaged application origin; the development server is accepted only in debug builds. There is no filesystem plugin with global scope or external telemetry.

Image import accepts PNG, JPEG, and WebP with matching filename extensions and signatures. It validates decoded data before returning the original encoded bytes as a data URL. The dimensions describe the original image after EXIF orientation; orientations 5–8 swap width and height. No pixels are re-encoded and no native colour simulation is applied. Limits match the frontend: 64 MiB encoded image, 65,535 pixels per dimension, 160 million pixels total, and a bounded 768 MiB native decode allocation. The temporary CPU image is dropped immediately after validation.

Projects use the `.matvision` extension. Native code validates UTF-8, JSON-object structure, and a 256 MiB byte limit; version migration and application schema validation belong to `src/project/`. PNG export validates the signature, dimensions, and complete compressed pixel stream with a 256 MiB encoded limit.

Saving writes a randomly named temporary file in the destination directory, flushes its contents, and atomically replaces the destination through `tempfile::NamedTempFile::persist`. Existing files are never deleted first. Failed validation preserves the previous file. Relative paths, parent traversal, Windows device paths, alternate streams, and non-file save destinations are rejected. File errors do not log or transmit user paths.

### File implementation validation

Twelve Rust tests pass: original PNG/JPEG/WebP bytes and dimensions; JPEG EXIF orientation; malformed images; encoded and decoded limits; project save/open/atomic overwrite; invalid-save preservation; Unicode and spaced filenames; invalid UTF-8/JSON; exact PNG export bytes; invalid paths; and rejection of remote command origins. Tests use isolated temporary directories below the local Cargo target directory. Native file-dialog cancellation and live IPC still require desktop integration testing.

Stable dependency references: [rfd 0.17.2](https://docs.rs/rfd/0.17.2/rfd/), [image 0.25.10](https://docs.rs/image/0.25.10/image/), and [tempfile atomic persistence](https://docs.rs/tempfile/3.27.0/tempfile/struct.NamedTempFile.html#method.persist). Cargo.lock pins the complete dependency graph.
