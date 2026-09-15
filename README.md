# MatVision Studio

Native Windows desktop studio for viewing printed desk mats in real-time WebGL2.
Tauri 2 + React + TypeScript + Three.js. All catalogue dimensions are physical millimetres,
converted to SI metres in the scene.

## Development

Prerequisites: Node.js 24 LTS, pnpm 11.19.0, stable Rust MSVC, Visual Studio C++ Build Tools
and Windows SDK, Microsoft WebView2. See the [official Tauri setup](https://v2.tauri.app/start/prerequisites/).

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm tauri dev
```

On the development host used for this repository, a workspace-local Rust/MSVC/SDK toolchain
is provisioned outside the repository. Run `. ./scripts/native-env.ps1` before the commands
above to use it. Other machines should use their normal installed prerequisites.

```powershell
pnpm tauri build
```

Windows installer output is under `src-tauri/target/release/bundle/nsis/`.
See `TESTING.md`, `ARCHITECTURE.md`, `docs/initial-audit.md`, and the release checklist
for verification evidence. A successful frontend build alone is not a desktop release.

## Interaction

Drag to orbit. Wheel to zoom. Right-drag to pan. Camera buttons provide standard views.
The product catalogue contains Desk Mat 900 × 400 mm and Mouse Pad 400 × 450 mm.

## Colour

Studio Preview displays scene lighting and material appearance. It is not an ICC soft proof.
Exact print matching needs a measured printer/ink/fabric profile and a calibrated monitor.

No external telemetry. Images are processed locally.
