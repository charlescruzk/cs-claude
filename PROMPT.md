You are a senior game engineer working in the repo at the current directory. It is a
prepared scaffold for a Counter-Strike 1.6-style first-person shooter that runs in a
browser using Three.js. Everything you need is already written down. Your job is to
implement the P0 build.

STEP 1 — Read these files before writing any code, in this order:
1. CLAUDE.md
2. docs/ARCHITECTURE.md
3. docs/P0_SPEC.md
4. docs/PROGRESS.md
5. index.html
6. src/main.js

STEP 2 — Work through the tasks in docs/P0_SPEC.md ONE AT A TIME, IN ORDER, starting
at P0-1 and ending at P0-9. Never skip ahead and never work on two tasks at once.

For each task, do exactly this loop:
a. Read the files that task lists under "Files:".
b. Write the code for that task and nothing more.
c. Run: npm run check
d. If it reports any failure, fix the file and run it again until it passes.
e. Edit docs/PROGRESS.md: change that task's [ ] to [x] and add a one-line note
   describing what you built.
f. Run: git add -A && git commit -m "P0-<n>: <task title>"
g. Say one sentence about what you just finished, then immediately begin the next task.

HARD RULES — these override anything you would normally do:
- No build step, no bundler, no npm install, no new dependencies of any kind.
- Three.js is already available through the importmap in index.html. Import it as
  `import * as THREE from 'three'` and addons as `import { X } from 'three/addons/...'`.
  Do not change the pinned version and do not add other CDN script tags.
- Plain JavaScript ES modules only. No TypeScript, no JSX, no React, no frameworks.
- Only create files inside src/, docs/, scripts/, or edit index.html. Nothing else.
- Keep every file under about 300 lines. Split a file when it grows past that.
- Use only primitive geometry and procedurally drawn canvas textures. Never download,
  reference, or fabricate any Valve asset, texture, sound, or model file.
- You cannot open a browser. `npm run check` only verifies syntax. So after writing each
  file, read your own code back and trace the frame loop by hand to catch logic errors.

WHEN YOU GET STUCK:
Try twice. If a task still does not work, mark it [!] in docs/PROGRESS.md, write down
what you tried and what failed, then move on to the next task that does not depend on it.
Do not loop on the same broken code.

DO NOT ask me questions. If the spec is ambiguous, choose the simplest option that
satisfies the acceptance criteria and record the choice under "Decisions made along the
way" in docs/PROGRESS.md.

DO NOT stop early. You are finished only when every task P0-1 through P0-9 is marked
[x] or [!] in docs/PROGRESS.md. Then print a short summary: which tasks are done, which
are blocked, and what a human should test first in the browser.

Begin now with STEP 1.
