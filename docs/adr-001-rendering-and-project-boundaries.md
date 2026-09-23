# ADR 001: Rendering and project boundaries

Status: accepted for initial native vertical slice.

## Decision

Use Tauri 2 + React/TypeScript + Three.js WebGL2. All physical values cross from millimetres to SI metres at the rendering boundary. Keep shared serializable contracts independent of frameworks. React owns project state; a disposable `SceneController` owns rendering. Native Rust provides file/platform services.

Store original encoded artwork inside versioned project JSON and maintain GPU preview resolution separately. Use explicit schema validation and migration rather than permissive object casts. Model empirical material compensation without representing it as ICC Print Proof.

## Consequences

Pure physical and persistence logic is testable without GPU. Project files remain portable but may be large; byte/file-size and decode limits are required. Renderer state updates must avoid resetting live camera interactions. CPU state can rebuild resources after WebGL context restoration. Contracts may precede implementations, but gate reports must not claim unsupported methods are working.
