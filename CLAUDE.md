# CLAUDE.md — rules for working in this repo

You are building a Counter-Strike 1.6–style browser FPS. Read `docs/P0_SPEC.md` for the
task list and `docs/ARCHITECTURE.md` for where code goes. Track status in `docs/PROGRESS.md`.

## How to work

1. Do **one task at a time**, in the order listed in `docs/P0_SPEC.md`. Do not skip ahead.
2. Before starting a task, read the files it says it touches. Read `docs/ARCHITECTURE.md`
   once at the start of the session.
3. After every task run `npm run check`. If it fails, fix it before moving on.
4. When a task's acceptance criteria are met, mark it `[x]` in `docs/PROGRESS.md` with a
   one-line note of what you did. Then start the next task.
5. If you are stuck on a task after two attempts, write what you tried under that task in
   `docs/PROGRESS.md`, mark it `[!]`, and move on to the next task that does not depend on it.
6. Never rewrite a file from scratch that already works. Make targeted edits.

## Hard constraints

- **No build step. No npm install. No bundler.** Everything runs from `index.html` served
  statically. Three.js comes from the importmap already in `index.html`.
- Import Three.js as `import * as THREE from 'three'` and addons as
  `import { X } from 'three/addons/...'`. Do not change the pinned version.
- Vanilla JavaScript ES modules only. No TypeScript, no JSX, no frameworks.
- Keep each file under ~300 lines. Split when it grows past that.
- One concern per file. Follow the folder layout in `docs/ARCHITECTURE.md` exactly.
- Do not add external dependencies of any kind (no other CDN scripts, no npm packages).
- Do not use Valve assets, names of real Valve maps as file names, or copied textures.
  Use primitive geometry and procedurally generated canvas textures.
- Do not create files outside `src/`, `docs/`, `index.html`, and `scripts/`.

## Verification you can run without a browser

```bash
npm run check     # node --check on every .js file under src/ and scripts/
```

This only proves syntax. For behavior, reason carefully about the code. You cannot open
a browser, so read your own code back after writing it and trace the frame loop by hand.

## Coding conventions

- `const` by default, `let` when reassigned, never `var`.
- Named exports. One default export only for the module's main class if it has one.
- Units: 1 world unit = 1 meter. Player eye height 1.6 m, capsule radius 0.4 m.
- Y is up. Forward is -Z (Three.js default).
- Time: `dt` in seconds, passed explicitly into every `update(dt)`.
- Game state lives in the objects created in `src/main.js`. Do not use globals except
  `window.__game` for debugging, set once in `main.js`.
- Comments explain *why*, not *what*. Keep them short.

## Commit discipline (if git is initialized)

Commit after each completed task with the message `P0-<n>: <task title>`.
