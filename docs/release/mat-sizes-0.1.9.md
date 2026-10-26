# Mat-only sizes — 0.1.9

The mat-only branch adds 80 × 30, 70 × 30, 40 × 30, 40 × 40, 18 × 22, 20 × 24, 20 × 25 and 25 × 25 cm profiles. Every profile starts at 3 mm thickness and exposes its full physical print rectangle. Existing 90 × 40 and 40 × 45 cm product IDs remain valid for saved projects.

The size menu shows a plain white rectangle on the right of each size. All previews use a common millimetre-to-pixel scale, preserving both proportions and relative sizes. It supports pointer selection, keyboard arrows/Home/End, Escape and closing when clicking outside.

Validation on 2026-10-26:

- Production TypeScript/Vite build and targeted ESLint passed.
- Product catalogue tests: 4 passed; project tests: 5 passed; camera/frustum tests including every new profile: 163 passed.
- Targeted browser checks passed for white preview proportions, all eight physical dimensions, 3 mm thickness, project save/reopen, outside-click closing and keyboard selection. The eight-switch software-GPU check uses a longer timeout and Low rendering quality; Ultra rendering exceeded the original 90-second test budget.
- Native Windows x64 EXE reported app version 0.1.9. All eight selections produced the expected metre dimensions and 0.003 m thickness; ten menu previews were present and no page errors were observed.
- Windows artifact built from commit `7665bee7529f9aaff7c1f09e7889d1cb423b48dc` in Actions run `40346028264`. Installed EXE SHA256: `D99DD1F20F31F7516100B36836738A7110CB0A7556AD82987A8E605AAF0A736B`.

No full regression or clean-Windows certification was performed. Local startup retains the previously configured app-specific WebView2 launcher; the Windows artifact itself uses the normal Tauri runtime discovery mechanism.
