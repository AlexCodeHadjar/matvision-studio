# Development

Use the sequential setup in README. Do not update dependency versions during a milestone.
`pnpm-lock.yaml` and `Cargo.lock` are required for repeatable builds.

## Dependency decision

The audit queried stable TypeScript 7.0.2, but typescript-eslint 8.70.0 declares and enforces
TypeScript <6.1 compatibility. Bootstrap therefore pins the current compatible stable
TypeScript 6.0.3. This is a deliberate compatibility decision; never suppress the parser's
unsupported-version error. Reassess both packages together in a later dependency review.

WDIO Tauri service 1.4.0 pins an older @wdio/globals. A scoped pnpm override aligns only
that dependency to 9.31.3, matching the installed assertion peer. External native driver
mode launches the actual Tauri executable.

## Boundaries

React components own controls; `StudioScene` owns renderer resources and the animation loop.
Physical product catalogue and project serialization are GPU-independent. No renderer code
belongs in Rust. Native commands perform file and platform tasks.

## Logs

Development logs are JSON records with APP, RENDERER, TEXTURE, PROJECT, EXPORT, PERFORMANCE
or NATIVE category. Never log encoded images or sensitive paths. No network telemetry.

## Quality gates

Run lint, typecheck and CPU tests for each implementation block. Run browser and native smoke
for viewport changes. Visually inspect captured images before accepting golden baselines.
Do not mark missing native/clean-machine evidence as passed.
