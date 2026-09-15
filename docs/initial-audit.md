# Initial environment audit

Date: 2026-09-15. Target: Windows 10/11 x64.

## Observed environment

- OS: Microsoft Windows 10.0.26200 (Windows 11 kernel build), x64.
- Node.js: 24.19.0. pnpm: 11.19.0. Git available.
- Visual Studio Community 2026 18.3.2 is installed; C++ workload/SDK validation pending.
- WebView2 runtimes: 152.0.4191.66 and 153.0.4234.32.
- Rust/cargo absent from PATH and default user cargo directory. Local workspace toolchain installation required.
- Empty project workspace. No existing application or AGENTS.md discovered.
- Restricted network rejects npm without approved escalation; approved npm registry reads succeed.

## Verified stable releases

Official npm registry dist-tag queries returned React 19.3.0, Three.js 0.186.0, Vite 8.3.0, TypeScript 7.0.2, Vitest 5.0.0, @tauri-apps/cli 2.11.4, @tauri-apps/api 2.11.1. Exact dependency declarations and pnpm-lock.yaml will freeze resolution at bootstrap. Cargo.lock will freeze Rust dependencies.

## Official references consulted

- https://v2.tauri.app/start/prerequisites/ — Windows MSVC, WebView2, Rust requirements.
- https://v2.tauri.app/release/ — Tauri core 2.11.5, build 2.6.3, CLI 2.11.4.
- https://v2.tauri.app/develop/tests/webdriver/ — recommended WebdriverIO Tauri service; native built-app testing is distinct from browser frontend testing.
- https://react.dev/versions — React 19.3 stable.
- https://www.npmjs.com/package/three — Three.js 0.186.0.
- https://vite.dev/releases — Vite 8.3 active stable line.
- https://www.typescriptlang.org/ — registry version must take precedence over older indexed release notes.

## Initial gate

NOT RUN. No PASS until Tauri binary launches, volume geometry/camera/lighting work, lint/typecheck/unit and relevant smoke tests pass, and QA reviews evidence. A browser build does not satisfy the native vertical slice.

## Release verification constraints

A fresh VM or second clean Windows machine has not been identified. Installation/uninstallation on this host cannot be described as clean-machine verification. Record evidence accurately and do not release with unmet blocking gates.

**Scope update from user, 2026-09-15:** clean-machine verification is waived for this delivery ("Пока обойдемся без этого"). Installation, launch and uninstall checks on the current Windows host remain required. The final checklist must record this as a user-approved exclusion, not a passing clean-machine test.

## Audit follow-up

- Portable Rust 1.98.1, MSVC 19.50 and Windows SDK were installed under workspace work/toolchain. A compiled native link probe executed successfully. No global PATH changes.
- The machine exposes Intel UHD Graphics and NVIDIA GeForce RTX 3050 Laptop GPU; CPU is Intel Core i5-12450H. WindowsSandbox.exe is absent.
- ESLint/TypeScript peer compatibility requires TypeScript 6.0.3 with typescript-eslint 8.70.0. TypeScript 7.0.2 was verified but is incompatible with this current parser. pnpm peers check is clean after this documented bootstrap adjustment.
- Frontend build, lint, typecheck and the initial 11 CPU tests passed. Initial screenshot inspection found depth fighting in the top cap; that visual baseline was rejected and is being corrected before gate acceptance.
