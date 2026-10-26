# Mat dimensions — 0.1.10

The former reference ruler was capped at 500 mm and did not measure the second edge. The new centimetre rulers span the full width and height of the selected product, with endpoints anchored to its actual local bounding rectangle. Both axes have exact final labels for non-round sizes, prominent total dimensions, 10 mm ticks and adaptive numeric labels.

Labels retain a readable screen size. Crowded intermediate labels are suppressed at shallow viewing angles. The camera makes room for the guides when enabled, and the guides follow the mat's rotation. Measurements describe the unfolded product, so the rulers are hidden while bending and when viewing the underside. The toggle is now named “Линейки · размеры коврика”.

Validation on 2026-10-26:

- Production TypeScript/Vite build and targeted ESLint passed.
- 176 targeted unit checks passed: complete ruler endpoints for all ten profiles, camera framing and reference texture accounting.
- A targeted browser check passed for 80 × 30 and 18 × 22 cm dimensions and matching ruler/mat rotation. Top-view screenshots were visually inspected.
- The installed Windows x64 EXE reported version 0.1.10. Native checks passed for full 800 × 300 mm and 180 × 220 mm dimensions, rotation tracking, hiding during rolling, and hiding from below. No page errors were observed. Native perspective and top-view screenshots were inspected.
- Build commit: `67d42e521b4be7d3767ac11e022eeffb0fc3a134`. Actions run: `40371709461`. EXE SHA256: `394B017ED2C8A68ACAF2D2C42CA5FDE8BEA0DBDD1A4B82F339F31593F54015D2`.

The desktop shortcut uses the existing app-specific WebView2 launcher. No full regression or clean-Windows certification was performed.
