# FIX PROMPT 6 — cs-browser: make single-player playable again

You are working in the `cs-browser` repo. Read `CLAUDE.md` before you touch anything.

The game is currently **unplayable** for a human. Reported: "mouse is going crazy" and
"unable to start the game because of the additional websocket ports". Both regressions were
introduced by the multiplayer lobby and the new start screen landing in the same overlay.
The headless probe stays green because it never renders a real overlay and never moves a
real mouse — which is exactly why these slipped through.

**This document is ONE RUN of three tasks.** Do them in order. The first is confirmed and
mechanical; the second is a diagnosis you must perform before fixing; the third is a probe
assertion so this class of bug can never pass green again.

Every hard constraint applies without exception:

- **No build step. No npm install. No bundler. No new dependencies.**
- Vanilla ES modules. `const` by default, `let` when reassigned, never `var`.
- Every file under ~300 lines. Targeted edits only. **Never rewrite a working file.**
- Do NOT run any `git` command until the push block at the end. Do NOT change anything
  under `src/net/` or `scripts/relay.mjs` — the network code is correct; it is the UI and
  the integration that are broken.

After each task: `npm run check`, then commit that task alone with the exact message given.

---

## The governing rule for this run

**With no room joined, the game must be indistinguishable from a game with no multiplayer
code in it.** No panel in the way, no connection attempt, no error text, no status line,
nothing about ports or relays anywhere on screen. Multiplayer is a collapsed option a
player can open on purpose. If a change would make the network visible to someone who did
not ask for it, it is wrong.

---

## Task 1 — CONFIRMED: the lobby panel is sitting on top of the PLAY button

`src/hud/netMenu.js:30-31` positions the panel:

```css
#net-menu { position: fixed; left: 50%; top: 50%; z-index: 7;
            transform: translate(-50%, 64px); cursor: default; }
```

That is viewport centre, shifted 64 px down, above every other layer. The start screen in
`index.html` centres `#title` in the same overlay, so the PLAY button and the controls text
sit **underneath this panel**. The panel's `_trapEvents` (`netMenu.js`, around line 148)
stops propagation of `click` / `mousedown` / `pointerdown`, so a click on the overlap never
reaches `#lock-overlay`'s handler and `input.requestLock()` never fires. **The player is
clicking a lobby they cannot see is in the way.** Nothing about ports is involved — that is
what the player concluded from the panel's status line.

### Fix — collapse it into a corner, closed by default

In `src/hud/netMenu.js`:

**(a)** Replace the positioning block above with a small anchored panel that never
overlaps the title:

```css
#net-menu { position: fixed; right: 18px; bottom: 18px; z-index: 7;
            width: 240px; cursor: default; text-align: left; }
#net-menu .nm-body { display: none; }
#net-menu.open .nm-body { display: block; }
#net-menu .nm-toggle { width: 100%; padding: 8px 10px; font: 12px/1 monospace;
                       letter-spacing: .12em; text-transform: uppercase; cursor: pointer;
                       background: rgba(0,0,0,.55); color: #a8a59c; border: 1px solid #333; }
#net-menu .nm-toggle:hover { color: #e8e6e0; }
```

**(b)** Wrap everything the panel currently renders (name field, room field, Join button,
status line) in a `<div class="nm-body">`, and add a `<button class="nm-toggle"
type="button">Multiplayer &#9656;</button>` above it that toggles the `open` class on
`#net-menu`. The toggle button must also `stopPropagation` its click, or opening the lobby
locks the pointer.

**(c)** **Nothing network-related runs until the player opens the panel and presses Join.**
Read the constructor: if it reads `localStorage`, that is fine (it is just remembering the
name/room). If it calls `net.connect`, `net.onStatus`, or renders any status text on
construction, stop that — status only appears after a Join attempt.

**(d)** In `src/main.js`, the `net.onStatus` wrapper must not surface anything on screen
unless a join was attempted. The simplest correct gate: track `let joinAttempted = false`,
set it to true inside the menu's Join path, and early-return from the wrapper when it is
false.

**Done when:** on a fresh load the start screen shows the title, PLAY, and the controls
with a small "MULTIPLAYER ▸" button in the bottom-right corner and **nothing else**;
clicking PLAY locks the pointer and starts the game immediately; the game runs with the
relay not running and shows no error anywhere.

Commit: `fix: lobby panel collapsed into a corner so it cannot block the PLAY button`

---

## Task 2 — DIAGNOSE, then fix: "mouse is going crazy"

Do **not** guess at this. The game already tells you the cause. Follow this procedure and
paste what you find into `docs/PROGRESS.md` before changing any code.

**Step 1 — read the on-screen diagnostics.** Run `npm run serve` and open
`http://127.0.0.1:8080/?diag=1` in a real browser (this is the one part of this run that
needs a real browser — the probe cannot reproduce it). Click PLAY. Look at:

- the **top-left** text. If it is red and starts with `UPDATE ERROR:`, that is the cause:
  an exception is thrown every frame inside the update loop. Because it is thrown *before*
  `input.endFrame()` runs, `mouseDX`/`mouseDY` are never reset and the last mouse delta is
  re-applied every frame — the camera spins on its own. Note the exact message and stack.
- the **cyan panel** bottom-left: `frames` must be climbing, `locked=true`,
  `updateErrored=false`.

**Step 2 — if there is an `UPDATE ERROR`,** fix the throw it names. The likely suspects, in
order, are all code that runs every frame *outside* the `input.locked` gate in
`src/main.js` and that the headless probe does not exercise with real input:

1. `netMenu.update()` (main.js ~line 266) — called every frame while unlocked; anything it
   reads on an unconstructed or unconnected client throws here.
2. `remotePlayers.update(dt)` and `net.update(dt)` — both are guarded on `connected`; confirm
   the guard is actually the first line of each.
3. `controller._footsteps(dt, vyBefore)` in `src/player/playerController.js` — new this
   week; it reads `this.input.keys` and emits `step` / `land` events into `src/audio/sfx.js`.
   A throw inside an `sfx` handler propagates back up through `events.emit` into the frame
   loop. Check `_noiseBurst` and `_tone` in `sfx.js` for a null `audio.ctx` or `audio._noise`
   on a browser where `AudioContext` construction failed.
4. `botManager.updateDead(dt, map.colliders)` — the ragdoll. Runs for dead bots only.

**Step 3 — if there is NO error and frames are climbing,** the input path itself is at
fault. Check, in this order:

1. `src/core/input.js` `mousemove` handler: it must only accumulate while `this.locked`, and
   `endFrame()` must zero `mouseDX`/`mouseDY`. Confirm `endFrame()` is the **last** call in
   the frame loop in `main.js` and that nothing between `beginFrame()` and `endFrame()` can
   `return` early.
2. `#net-menu`'s `_trapEvents`: it must trap **only** `click`, `mousedown`, `pointerdown`,
   `dblclick`, `contextmenu`, `keydown`. If `mousemove`, `mouseup`, `pointerup` or `keyup`
   are in that list, remove them — a swallowed `mouseup` leaves a mouse button latched in
   `input.mouseDown` and the rifle auto-fires, which players describe as the mouse going
   crazy.
3. `SENS` in `playerController.js` is `0.0025`. If it has changed, restore it.

**Step 4 — whatever you find, the fix must be the smallest change that makes the game
playable.** Do not restructure the frame loop. Do not add try/catch around systems to hide
the throw — the engine already reports it once and keeps rendering; the goal is to remove
the throw, not to silence it.

**Done when:** with `?diag=1`, clicking PLAY gives `updateErrored=false`, `frames` climbing,
and moving the mouse turns the view smoothly with no drift when the mouse is still.

Commit: `fix: <one line naming the actual cause you found>`

---

## Task 3 — Make the probe catch this class of bug

`scripts/cs_probe.mjs` clicks "Click to play" and checks state once, but never runs frames
with synthetic input. Add one behaviour block, `=== BEHAVIOR (input loop) ===`, evaluated
after the click, that:

1. Forces `g.input.locked = true` (the probe's stubbed pointer lock may not fire the
   change event).
2. Runs `g.engine._updateFn(1/60)` **240 times**, and on every 10th frame sets
   `g.input.mouseDX = 12; g.input.mouseDY = -5;` *before* the call.
3. Asserts, and prints as `key: true/false`:
   - `noUpdateError`: `g.engine._reportedError === false` after all 240 frames
   - `deltaReset`: `g.input.mouseDX === 0 && g.input.mouseDY === 0` after every frame
     (accumulate a single boolean)
   - `bootStatusHealthy`: `#boot-status` text does not start with `UPDATE ERROR` or
     `FRAME LOOP STALLED`
   - `overlayStillHidden`: `#lock-overlay` has the `hidden` class

This turns "mouse going crazy" from something only a human can see into a red line in
`npm run probe`. If Task 2 was fixed correctly this block is green on the first run; if it is
red, Task 2 is not done.

Commit: `test: probe drives 240 frames of synthetic input and asserts the loop stays clean`

---

## End of run — verify and push

```bash
npm run check          # must pass every file
npm run probe          # must be exception-free; the new input-loop block must be all true
git fetch origin
git push origin main
git rev-list --count origin/main..main     # must print 0
```

A plain fast-forward push works. Do **not** use `--force`. If the push is rejected, stop
and report it.

In `docs/PROGRESS.md`, record: the exact `UPDATE ERROR` text you saw (or that there was
none), what the root cause of the mouse problem turned out to be, and that Task 1 was
verified by eye in a real browser.

If Task 2's diagnosis does not match any of the listed suspects, write exactly what
`?diag=1` and the console showed under Task 2 in `docs/PROGRESS.md`, mark it `[!]`, and
stop — do not improvise a fix for a cause you have not identified.
