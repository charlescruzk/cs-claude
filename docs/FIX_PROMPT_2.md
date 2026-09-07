# FIX PROMPT 2 — cs-browser: "it loads but it doesn't actually play"

You are working in the `cs-browser` repo. Read `CLAUDE.md`, `docs/ARCHITECTURE.md` and
`docs/PROGRESS.md` first. All the hard constraints still apply: no build step, no npm
install, no bundler, no new dependencies, vanilla ES modules, Three.js from the importmap,
files under ~300 lines, targeted edits only — never rewrite a working file from scratch.

Do **one task at a time**. After each task run `npm run check`. Commit after each task with
`fix: <task title>`. Do not `git push`.

---

## What is already known — do not re-investigate this

The game is deployed at https://charlescruzk.github.io/cs-claude/ and **boots correctly**.
All 27 modules load, `window.__game` builds with all 17 subsystems, Three r170 is live.
The `const grounded` blocker from `docs/FIX_PROMPT.md` Task 1 is genuinely fixed
(`src/player/playerController.js:123` reads `let grounded`).

The game **logic is sound**. It was verified by driving `engine._updateFn(1/60)` by hand,
900 frames, with `input.locked` forced true and synthetic input covering mouse look,
jumping, all four weapons, firing, scoping, reload, frag and flash:

- zero exceptions thrown
- round advanced `freeze` → `live`, timer decremented correctly
- player moved 4.1 m on held `KeyW`, yaw/pitch tracked the mouse deltas
- bots stayed alive, no NaN, no state corruption

**Therefore the bug is not in the game logic.** Everything in `src/main.js:123` is gated
behind `if (input.locked)`. The reported symptom is: pointer lock *succeeds* (the overlay
clears, which only happens via `_onLockChange(true)` at `src/main.js:38`) but the world is
frozen and the timer never counts down.

That combination is not currently explainable from the code, because:

- `hud.update` runs **unconditionally** at `src/main.js:141`, outside the lock gate — so a
  frozen timer means the update function is not executing at all
- `Engine._frame` re-queues `requestAnimationFrame` *before* its `try`, so a thrown
  exception cannot stop the loop
- any thrown exception is caught and reported once through `engine.onError` into
  `#boot-status` — the user reports no such red text

The leading hypothesis is that **`requestAnimationFrame` is not firing**, or is firing
without `input.locked` actually being true. Nothing in the code reports either condition.

**Your first job is to make the failure observable, not to guess at it.**

---

## Task 1 — Surface pointer-lock failure (it is currently silent)

`src/core/input.js`. `requestLock()` calls `this.canvas.requestPointerLock()` and ignores
the outcome completely. There is no `pointerlockerror` listener and no promise `.catch`.
When pointer lock is refused — a browser setting, an embedded/inactive document, Chrome's
~1 s cooldown after an `Esc` exit — the game becomes silently, permanently dead. The page
has elaborate boot-error reporting and none for the one interaction the whole game gates on.

Add a `this._onLockError = null;` callback beside the existing `this._onLockChange = null;`
in the constructor, then:

```js
requestLock() {
  let p;
  try {
    p = this.canvas.requestPointerLock();
  } catch (err) {
    if (this._onLockError) this._onLockError(err.message);
    return;
  }
  // Chrome returns a promise; Safari/older Chrome return undefined.
  if (p && p.catch) p.catch((err) => {
    if (this._onLockError) this._onLockError(err.name + ': ' + err.message);
  });
}
```

And in `_bind()`, beside the existing `pointerlockchange` listener:

```js
document.addEventListener('pointerlockerror', () => {
  if (this._onLockError) this._onLockError('pointerlockerror (browser refused the lock)');
});
```

In `src/main.js`, beside the existing `input._onLockChange = ...` line:

```js
input._onLockError = (msg) => {
  status.textContent = 'POINTER LOCK FAILED: ' + msg +
    '\nThe game only runs while the pointer is locked. Click again, or check the site\'s ' +
    'pointer-lock permission in your browser settings.';
  status.style.color = '#ff6b6b';
  status.style.whiteSpace = 'pre-wrap';
};
```

**Done when:** a refused pointer lock puts a red message on screen instead of doing nothing.

---

## Task 2 — BLOCKER DIAGNOSTIC: a frame-loop watchdog

This is the task that will actually identify the reported bug. The game must be able to
tell the user *why* it is frozen.

`src/core/engine.js`: add `this.frames = 0;` in the constructor and `this.frames++;` as the
first statement inside `_frame()`.

`src/main.js`: after `engine.start(...)`, add a watchdog that checks once a second whether
the loop is advancing while the pointer is locked, and reports the exact state when it is
not. Keep it under ~20 lines; put it in `src/core/debug.js` and import it if `main.js`
would exceed ~160 lines.

```js
// A frozen game must say why. Once locked, the loop must advance; if it does not,
// report the state that explains it instead of sitting on a dead frame.
let lastFrames = 0;
setInterval(() => {
  const advancing = engine.frames > lastFrames;
  lastFrames = engine.frames;
  if (!input.locked || advancing) return;
  status.textContent =
    'FRAME LOOP STALLED\n' +
    `frames=${engine.frames} locked=${input.locked} ` +
    `lockEl=${document.pointerLockElement ? document.pointerLockElement.id : 'null'}\n` +
    `visibility=${document.visibilityState} round=${round.state} t=${round.time.toFixed(1)} ` +
    `updateErrored=${engine._reportedError}`;
  status.style.color = '#ff6b6b';
  status.style.whiteSpace = 'pre-wrap';
}, 1000);
```

**Done when:** locking the pointer on a machine where the game freezes prints a
`FRAME LOOP STALLED` line naming `frames`, `locked`, `visibility` and `round`. On a healthy
machine the watchdog stays silent forever.

---

## Task 3 — `?diag=1` live state readout

`src/core/debug.js` already owns the `?debug=1` FPS counter and collider boxes. Add a
parallel `?diag=1` flag that creates a fixed-position DOM panel (from JS — do **not** add it
to `index.html`) refreshed once a frame with:

`fps · frames · locked · pointerLockElement · visibilityState · round.state · round.time ·
player.pos · engine._reportedError`

It must be completely inert when the flag is absent, exactly like `?debug=1`.

**Done when:** `https://<host>/?diag=1` shows a live panel and the plain URL shows nothing.

---

## Task 4 — Do not let the round die with the mouse

Only after Tasks 1–3 are committed and verified.

If Task 2 proves the loop is alive but `input.locked` is false while the overlay is hidden,
the overlay and the lock state have diverged. Make `_onLockChange` the single source of
truth: the overlay's `hidden` class must be set from `document.pointerLockElement === canvas`
on every `pointerlockchange`, and the game must re-show the overlay whenever the lock drops.
Do not add a second code path that hides the overlay.

If Task 2 instead proves `requestAnimationFrame` is not firing at all, record that in
`docs/PROGRESS.md` under `## Known issues` with the watchdog output pasted verbatim, and
**stop** — do not attempt a fix without knowing which of the two it is.

---

## Task 5 — Record what actually happened

`docs/PROGRESS.md`:

1. Add a `## RESUME — <today>` block stating that the P0/P1 build is code-complete and
   logic-verified (900-frame manual drive, zero exceptions), and that the outstanding
   defect is a pointer-lock / frame-loop failure, not a gameplay bug.
2. Paste the `npm run probe` output.
3. Paste the watchdog output from the failing machine if you have it.
4. Do not mark anything verified on the strength of `npm run check` alone.

---

## Verification

```bash
npm run check     # syntax only — necessary, never sufficient
npm run probe     # loads the page in headless Chrome and clicks "Click to play"
```

`npm run probe` is the only automated check that exercises the real browser path. Run it
after Task 1 and again after Task 3.

Note that headless Chrome may itself refuse pointer lock — if the probe reports
`POINTER LOCK FAILED`, that is Task 1 working correctly, not a regression.
