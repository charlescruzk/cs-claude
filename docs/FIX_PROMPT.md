# FIX PROMPT — cs-browser P0 repair pass

You are working in the `cs-browser` repo. Read `CLAUDE.md`, `docs/ARCHITECTURE.md` and
`docs/P0_SPEC.md` first. All the hard constraints there still apply: no build step, no npm
install, no bundler, no new dependencies, vanilla ES modules, Three.js from the importmap,
files under ~300 lines, targeted edits only — never rewrite a working file from scratch.

The P0 build is code-complete but has never run. An audit found one game-breaking runtime
bug plus a set of correctness and spec-compliance defects. Fix them in the order below.
Do **one task at a time**. After each task run `npm run check`. After task 1 and again at
the end, run `node scripts/cs_probe.mjs` and paste its output into `docs/PROGRESS.md`.

---

## Task 1 — BLOCKER: `const` reassignment crashes the frame loop

`src/player/playerController.js`, in `vertical(dt)`:

```js
const grounded = resolveCapsuleVsBoxes(this.pos, RADIUS, this.height, this.colliders, { vy: this.vel.y });
if (this.pos.y <= 0) {
  this.pos.y = 0;
  if (this.vel.y < 0) this.vel.y = 0;
  grounded = true;          // <-- TypeError: Assignment to constant variable.
}
```

The player spawns at `y = 0`, so this throws on the very first frame after pointer lock.
The throw escapes `Engine._frame` before `renderer.render()`, so the screen freezes on the
last pre-lock frame. **This — not `file://` — is the real cause of "Click to play and
nothing happens."** `node --check` cannot see it because it is a runtime error, not a
syntax error.

**Fix:** change `const grounded` to `let grounded`. One word.

**Then verify:** run `node scripts/cs_probe.mjs`. It must report no uncaught exceptions and
a `#boot-status` reading `three r170 — ...` (not `JS ERROR`). Do not continue until it does.

---

## Task 2 — A thrown error must never kill rendering permanently

`src/core/engine.js`, `_frame()`. Today one exception in `updateFn` silently stops every
subsequent render, which is why the bug above looked like "nothing happens".

Wrap the update call so the game degrades visibly instead of freezing:

```js
_frame() {
  if (!this._running) return;
  requestAnimationFrame(this._frame);
  let dt = this.clock.getDelta();
  if (dt > 0.1) dt = 0.1;
  try {
    this._updateFn(dt);
  } catch (err) {
    // Report once, then keep rendering so the failure is visible on screen
    // rather than freezing the last good frame.
    if (!this._reportedError) {
      this._reportedError = true;
      console.error('[engine] update failed:', err);
      if (this.onError) this.onError(err);
    }
  }
  this.renderer.render(this.scene, this.camera);
}
```

Add `this._reportedError = false;` and `this.onError = null;` in the constructor. In
`src/main.js`, set `engine.onError = (err) => { status.textContent = 'UPDATE ERROR: ' + err.message; status.style.color = '#ff6b6b'; };`

**Done when:** an exception thrown from the update function shows on screen and the scene
keeps rendering.

---

## Task 3 — Collision resolves on the wrong axis at wall ends

`src/core/physics.js`, `resolveCapsuleVsBoxes`. The spec says "pushes the player out of any
overlapping box **along the minimum axis**". The current code resolves X fully for every
collider, then Z fully. Walking into the *end cap* of a thin wall (the lane walls are 1 m
thick and 30 m long) ejects the player sideways along X instead of stopping them along Z.

Replace the two separate X and Z loops with one loop that picks the smaller of the two
horizontal penetrations per collider. Keep the `STEP` skip and keep the Y pass exactly as
it is, after the horizontal pass.

```js
// --- horizontal: resolve each overlap along its axis of least penetration ---
for (const c of colliders) {
  const b = playerBox(pos, radius, height, _p);
  if (!aabbOverlap(b, c)) continue;
  if (c.max.y - pos.y <= STEP) continue; // low enough to step/jump over

  const left  = pos.x + radius - c.min.x;    // push toward -x
  const right = c.max.x - (pos.x - radius);  // push toward +x
  const back  = pos.z + radius - c.min.z;    // push toward -z
  const fwd   = c.max.z - (pos.z - radius);  // push toward +z

  const pushX = left < right ? -left : right;
  const pushZ = back < fwd ? -back : fwd;
  if (Math.abs(pushX) <= Math.abs(pushZ)) pos.x += pushX;
  else pos.z += pushZ;
}
```

**Done when:** walking straight into the open end of a lane wall stops you; walking along a
wall face still slides.

---

## Task 4 — Bots' line-of-sight ignores the player's height

`src/bots/bot.js`, `_lineOfSight`. `player.eye` is an *offset above the feet* (1.6 / 1.0),
not a world Y. The code does `_ray.set(dx, player.eye - EYE, dz)` → always `0`, so the LOS
ray is permanently horizontal at y = 1.6 and ignores `player.pos.y` entirely. A player
standing on a 2 m ledge or crouching is tested against the wrong ray.

```js
_eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
_ray.set(dx, (player.pos.y + player.eye) - (this.pos.y + EYE), dz);
```

Leave the rest of the function alone.

**Done when:** a bot engages a player standing on a crate or ledge, and loses sight when the
player drops behind a 2 m wall.

---

## Task 5 — The two "elevated ledges" cannot be reached

`src/map/mapData.js`. Both ledges are two 3×3×1 crates stacked on the **same footprint**,
so each is a flush 2 m column with no step. Jump velocity is 7.2 under gravity 20, peak
`7.2² / (2·20) = 1.30 m` — a 2 m top is unreachable. P0-3 requires the ledges be
"reachable by ramps or stacked boxes".

Add one 1 m step crate beside each stack (do not change the existing boxes, do not exceed
80 boxes total):

```js
{ pos: [-20, 0.5, 13], size: [3, 1, 2], tex: 'crate' }, // step up to west ledge
{ pos: [20, 0.5, -13], size: [3, 1, 2], tex: 'crate' }, // step up to east ledge
```

**Done when:** you can jump onto the 1 m step, then onto the 2 m ledge top, from the floor.

---

## Task 6 — The bombsite ring is buried under its own platform

`src/map/mapBuilder.js`. The ring is placed at `y = 0.05`, but the bombsite-A platform box
spans `y = 0 … 0.2` over exactly that area, so the ring is invisible inside it.

Raise the ring so it sits on top of the platform: `ring.position.set(site.pos[0], 0.25, site.pos[2]);`

**Done when:** the yellow ring is visible on the bombsite platform.

---

## Task 7 — Delete the P0-1 test world

`src/core/engine.js` still carries `_buildTestWorld()`, `this.testCube`, `this._testGroup`
and `clearTestWorld()`. P0-3 said to remove the test cube; today it is built every boot
(a 50×50 plane plus a cube) and then thrown away one line later in `main.js`.

Delete `_buildTestWorld`, `clearTestWorld`, `this.testCube`, `this._testGroup` and both
constructor lines that build/add the group. Remove the `engine.clearTestWorld();` call from
`src/main.js`. Keep everything else in the Engine constructor.

**Done when:** the map still renders and `npm run check` passes.

---

## Task 8 — De-duplicate `rayAABB`

`rayAABB` is copy-pasted in `src/weapons/hitscan.js` and `src/bots/bot.js`.
`docs/PROGRESS.md` already flags this as a P0-9 item.

Move one canonical version into `src/core/physics.js` and export it:

```js
// Ray-vs-AABB slab test. Returns the entry distance in [0, maxT], or null on a miss.
// `dir` must be normalized.
export function rayAABB(origin, dir, min, max, maxT = Infinity) { /* ... */ }
```

Import it in both `hitscan.js` and `bot.js` and delete both local copies. `hitscan.js`
calls it with the default `maxT`; `bot.js` passes the segment length. Behaviour must not
change.

**Done when:** shooting still stops at walls, and bot LOS still blocks behind crates.

---

## Task 9 — Use `spawnFor` for the player's first spawn

`src/main.js` hand-rolls the initial spawn:

```js
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const spawn = pick(map.spawns.t);
const firstSpawn = { x: spawn[0], z: spawn[1] };
```

`src/game/teams.js` already exports `spawnFor(team, spawns, index?)` which does exactly
this. Replace the three lines with `const firstSpawn = spawnFor('t', map.spawns);` and
import `spawnFor` from `./game/teams.js`. Delete the now-unused `pick`.

---

## Task 10 — P0-9: `?debug=1` overlay

`src/main.js` (plus a new `src/core/debug.js` if it pushes `main.js` past ~120 lines).

When `new URLSearchParams(location.search).get('debug') === '1'`:
- Show an FPS counter (rolling average over the last 30 frames) in a fixed-position DOM
  element you create from JS — do not add it to `index.html`.
- Add a `THREE.Group` of wireframe `BoxGeometry` meshes, one per entry in
  `map.colliders`, sized/positioned from each collider's `min`/`max`, using
  `new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true })`.

Both must be completely inert when the flag is absent.

**Done when:** `http://127.0.0.1:8080/?debug=1` shows FPS and green collider boxes, and the
plain URL shows neither.

---

## Task 11 — Honest `docs/PROGRESS.md`

1. **Replace the entire `## RESUME — 2026-09-04` block.** Its diagnosis is wrong: the game
   did not fail because of `file://`; it failed because of the `const grounded`
   reassignment in Task 1. Say so plainly, and say that `npm run check` (syntax only)
   cannot catch runtime errors of this class — which is why `scripts/cs_probe.mjs` must be
   run before any task is marked verified.
2. Mark P0-9 `[x]` with a one-line note once Task 10 is done.
3. Rewrite `## Known issues` to reflect reality after this pass. Keep the honest entries
   that are still true (bots deal flat damage with no headshot multiplier; the `Round` kill
   listener is never unregistered). Add anything you could not fix.
4. Do not mark any task verified on the strength of `npm run check` alone.

---

## Task 12 — Add a probe script to package.json

In `package.json`, add to `"scripts"`: `"probe": "node scripts/cs_probe.mjs"`.

---

## Task 13 (last, optional) — Indentation

Many files under `src/` have inconsistent leading whitespace on closing braces (3-space,
5-space, 7-space). Normalize to 2-space indentation. Do this **only after every task above
is done and verified**, one file per commit, and re-run `npm run check` after each file.
Do not change any logic.

---

## Verification you must run

```bash
npm run check     # syntax only — necessary, never sufficient
npm run probe     # actually loads the page in headless Chrome and clicks "Click to play"
```

Then, manually: `npm run serve` and open `http://127.0.0.1:8080` — play three consecutive
rounds with the console open and confirm zero errors, per P0-9.

## Commit discipline

One commit per task: `fix: <task title>`. Do not squash. Do not commit
`docs/FIX_PROMPT.md` changes together with code changes.
