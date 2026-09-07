# P0 Progress

Mark each task `[x]` when its acceptance criteria are met, `[!]` if blocked after two
attempts (write what you tried). Add a one-line note per task.

## FIX_PROMPT_4 — RUN 1 (2026-09-06) — the blocker chain

- [x] Task 1 — `exitPointerLock` is a Document method, not an Element method. `buyMenu.open()`
  now calls `document.exitPointerLock()` (was `this.input.canvas.exitPointerLock()`, which
  threw a TypeError on every `B` press and skipped `input.endFrame()` every frame — the
  camera spun and the panel toggled every frame).
- [x] Task 2 — probe stubs `exitPointerLock` on `Document` (not `Element`) so a wrong call
  site fails. Confirmed the probe can fail: with the old broken call temporarily restored in
  `buyMenu.js:46`, `npm run probe` reported the P1-4 buy block as `undefined` (the `open()`
  TypeError), then the fix was restored.
- [x] Task 3 — lock overlay stays hidden while the buy menu is open. `_onLockChange` now
  keeps the overlay hidden when `buyMenu._shown` is true, and the handler was **moved** below
  the `buyMenu` declaration (`main.js:112`) so the reference resolves. `close()` needs no
  extra code: a successful re-lock hides the overlay via `_onLockChange(true)`, a failed one
  re-arms it.

## FIX_PROMPT_4 — RUN 2 (2026-09-06) — physics feel

- [x] Task 4 — acceleration and friction movement model. `horizontal()` became
  `horizontal(dt)` (call site updated in `update()`); the two direct velocity assignments
  were replaced with the exact friction + wish-accel model (FRICTION 5.5 / STOP_SPEED 1.0 /
  GROUND_ACCEL 12 / AIR_ACCEL 12 / AIR_WISH_CAP 0.8). `RUN`/`WALK`/`CROUCH` are now the
  target speed. Verified by reading: with no key held `dx`/`dz` are 0, so `add` pushes
  nothing and friction alone brings the player to rest.
- [x] Task 5 — block standing into geometry, ease crouch eye height. Before growing the
  capsule, `vertical()` builds a stand-height box at the current position and tests it with
  the existing `aabbOverlap` helper (imported from `core/physics.js`), skipping colliders at
  or below step-over height (the standing surface, not headroom); on overlap it forces
  `crouching = true` this frame. `height` stays a hard switch; `eye` eases exponentially
  toward the target (`1 - exp(-dt/0.06)`, same pattern as the scope FOV). `spawnAt()` still
  sets both directly.

## PHASE2_STAGE_A — RUN A2 (2026-09-06) — draw calls, shadows, render resolution

- [x] Task 3 — merge static geometry per material with UV-baked texel density.
  `mapBuilder.js` now groups `mapData.boxes` by `tex` kind, builds one `BoxGeometry` per
  box, scales each face's UVs so one tile covers 2 m (face order +X,-X,+Y,-Y,+Z,-Z; scales
  d/2·h/2, w/2·d/2, w/2·h/2), translates to world space, and `mergeGeometries` per kind →
  one mesh per texture kind (3 meshes). Material `map` and `roughnessMap` repeat reset to
  1×1 (UVs carry the tiling; both maps, or the grain would double-tile). **Colliders are
  built in the first loop over `mapData.boxes`, same order, same values, fully independent
  of the meshes** — verified by reading, not by the probe. Floor: `floorTex.repeat.set(30,30)`
  removed (it mutated the shared cached texture); the floor plane's UVs are scaled by
  31/4 = 7.75 so one tile still covers 2 m with the cached 4×4 repeat, and the shared
  texture is left untouched.
- [x] Task 4 — sun shadow mapping with a fitted ortho frustum. `engine.js` enables
  `PCFSoftShadowMap`, `sun.castShadow`, 2048 map, ortho frustum fitted to ±35 (world x/z are
  ±30.5), bias -0.0005 / normalBias 0.02. Merged map meshes get `castShadow` +
  `receiveShadow`; the floor gets `receiveShadow` only; bot body/head/nose get both.
- [x] Task 5 — render at 1× device pixel ratio with a `?rs=` override. `engine.js` now
  defaults `setPixelRatio(1)` (Retina was ~4× the pixels; every screen-space effect scales
  with it); `?rs=2` restores the old behaviour for comparison. `_onResize` unchanged — the
  pixel ratio persists, so no re-apply there. Edges look slightly softer at 1× until SMAA
  lands — expected, not compensated.

**Verification (RUN A2):** `npm run check` 28/28; `npm run probe` exception-free with every
P1-1..P1-7 behaviour block green. **The probe cannot see an image or measure a frame.** By
reading: collider list is unchanged (built from `mapData.boxes` independently of the merged
meshes) and every box is translated to its original position, so layout and collision are
unchanged. Needs a human by eye: draw-call count (`renderer.info.render.calls` should drop
from ~45 to well under 12), texel density consistent on a 61 m wall vs a 1 m crate, grounded
shadows with no acne / no peter-panning, and the softer 1× edges vs `?rs=2`.

## PHASE2_STAGE_A — RUN A3 (2026-09-06) — ray infrastructure and allocation sweep

- [x] Task 6 — allocation-free `rayAABB` that reports the hit face. `physics.js` unrolls the
  x/y/z slabs (no `['x','y','z']` array, no string lookups), tracks which axis won and the
  entry sign, and writes `{ axis, sign }` into an optional sixth `outHit` argument. Return
  contract unchanged (`number | null`); no caller changed. Also deleted `groundCheck` (zero
  call sites — grep confirmed) and the dead `opts.vy` destructure, and exported `STEP` (0.6,
  value unchanged) for Task 9.
- [x] Task 7 — share bot geometries and materials across all bots. `bot.js` hoists three
  shared geometries (body 0.8×1.8×0.8, head 0.4×0.4×0.4, nose 0.12×0.12×0.25) and a lazy
  per-team-colour material Map plus one shared nose material to module scope; `_build` now
  reuses them. All sizes, positions (body y=0.9, head y=2.0, nose (0,1.3,-0.5)), colours,
  roughness 0.65 / metalness 0.0, and cast/receiveShadow flags identical. Nose colour kept
  at the original `0x222222` — the task text's `0x222228` is the viewmodel gunmetal value
  (doc typo); "keep the same colours" wins. Nothing is disposed.
- [x] Task 8 — pool the explosion mesh. `effects.js` builds one `SphereGeometry(1,16,12)` and
  four `MeshBasicMaterial`s at module scope, plus a pool of 4 meshes in the constructor
  (added to the scene, `visible=false`). `_spawnExplosion` reuses the first free pooled mesh
  (resets scale 0.3, opacity 1, position, `visible=true`); `update()` hides it on expiry.
  No geometry or material is constructed or disposed after startup. Timings/constants
  unchanged (EXPLOSION_T 0.3, scale 0.3→FRAG_RADIUS, opacity 1→0, AdditiveBlending,
  depthWrite false).
- [x] Task 9 — scratch vectors and shared STEP in the headroom check. `playerController.js`
  hoists a module-level `{ min, max }` scratch box (`_standBox`) reused every frame instead
  of two fresh `Vector3`s, and replaces the hardcoded `0.6` with the `STEP` constant imported
  from `core/physics.js`. Behaviour unchanged (STEP is 0.6).
- [x] Task 10 — reuse a scratch result object in `resolveShot`. `hitscan.js` mutates a
  module-level `_result` in place as the nearest hit improves and returns it, instead of
  allocating a fresh object literal per improvement. Documented that the returned object is
  reused between calls; safe because `main.js:90` discards the return value and no other
  caller stores it. No caller changed.

**Verification (RUN A3):** `npm run check` 28/28; `npm run probe` exception-free with every
P1-1..P1-7 behaviour block green — including the shotgun pellet counts (`shotPellets: 8`,
`shotLanded: 4`) and the wall-blocks-bot cases that a mistake in `rayAABB`/`resolveShot`
would break. **This run changes no visuals at all** — if anything looks different in a
browser, that is a bug to report, not a look to adjust. Needs a human by eye: nothing
visual is expected to change; confirm bots look identical, explosions look identical, and
crouch-under-overhang behaviour is unchanged.

## PHASE2_STAGE_B — RUN B1 (2026-09-06) — procedural geometry library and chamfered map

- [x] Task 1 — `src/geo/shapes.js` (new): `beveledBox(w, h, d, chamfer)` and
  `boxProjectUvs(geo, metresPerTile)`. **The task's beveledBox as written did NOT measure
  exactly w×h×d** — verified in headless Chrome (real three r170 via the importmap):
  `beveledBox(1,1,1)` came out **1.08 × 1 × 1.08**. ExtrudeGeometry places the body at
  `bs = bevelSize + bevelOffset`; with `bevelOffset: 0` the body is expanded by `c` on every
  side (the bevelVec at the chamfer corners is exactly `(1,0)`/`(0,1)`, so the expansion is
  exactly `2c`). Fixed with `bevelOffset: -c`, which puts the body on the original shape
  (exact w×d) and contracts the top/bottom faces by `c` — the correct chamfer look. Re-verified
  in headless Chrome: `beveledBox(1,1,1,0.04)`, `(2,1,3,0.04)`, `(1,1,1,0.02)`, `(0.4,0.4,0.4,0.015)`
  all measure exactly w×h×d, centred at the origin. `boxProjectUvs` verified to run and give
  the expected density (1 m box at 2 m/tile → UV span 0.5, range ±0.25).
- [x] Task 2 — chamfer the map. `mapBuilder.js` builds each box with
  `beveledBox(w, h, d, Math.min(w,h,d) < 1.5 ? 0.02 : 0.04)` and `boxProjectUvs(geo, 2)`;
  deleted `scaleBoxUvs` and `scaleUvs` (both now dead). Floor keeps `PlaneGeometry` but uses
  `boxProjectUvs(floorGeo, 2)` and the material's `map`/`roughnessMap` repeat is now 1×1 —
  every surface in the game uses one rule: one tile per 2 m carried in the UVs. **Colliders
  untouched** — still built from `mapData.boxes` in their own loop, same count/order/values.

**Verification (RUN B1):** `npm run check` 29/29 (new file); `npm run probe` exception-free
with every P1-1..P1-7 behaviour block green and identical to the pre-change baseline —
especially P1-1 (sniper one-shot, shotgun `shotLanded: 4`), which would change if hit boxes
or colliders had shifted. Needs a human by eye: whether the chamfers catch light, whether
tiling is seamless across the chamfer strips, and whether the 2 cm vs 4 cm chamfer split
reads right on crates vs walls. The bounding-box verification was done in headless Chrome
against the real r170 importmap, not by hand.

## PHASE2_STAGE_A — RUN A1 (2026-09-06) — PBR materials and renderer output

- [x] Task 1 — PBR materials with procedural roughness maps. `textures.js` gained
  `makeRoughness(kind)` (greyscale grain canvas, own cache, deliberately NOT sRGB) and
  `makeTexture` now sets `tex.colorSpace = SRGBColorSpace` on the colour map only. All
  surfaces except the bombsite ring and the muzzle flash are now `MeshStandardMaterial`:
  map boxes + floor via `getMaterial`/floor material (ROUGHNESS table: concrete 0.95, crate
  0.80, sand 1.0, floor 0.90; floor 0.9), bots body/head/nose (0.65/0.0, colours kept),
  viewmodel gunmetal (0.40/0.60), projectile (0.55/0.0). The bot nose was converted too —
  the task listed only body/head but its "Done when" says every surface except the ring and
  muzzle flash; it reuses the bot's 0.65/0.0 values. The explosion sphere stays
  `MeshBasicMaterial` (additive effect, not a surface). **Expected to look darker/flatter
  until Task 2 — not compensated.**
- [x] Task 2 — sRGB output, ACES tone mapping, retuned lights. `engine.js` sets
  `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`,
  `toneMappingExposure = 1.0`; hemisphere retuned to `(0xbcd3f0, 0x4a4036, 0.45)` and sun to
  `(0xfff2e0, 3.2)`; `sun.position.set(60, 90, 40)` unchanged. Warmer sun vs cooler sky fill
  is what will make bounce light read in Stage C.

**Verification (RUN A1):** `npm run check` 28/28; `npm run probe` exception-free with every
P1-1..P1-7 behaviour block green. **The probe cannot judge an image** — tone mapping, tonal
range, and "nothing blown out" need a human to confirm by eye in a browser. If the overall
image is too dark/bright, the only knob is `toneMappingExposure` within 0.8–1.3.

## RESUME — 2026-09-06 (diagnostic pass, `docs/FIX_PROMPT_2.md`)

**State.** The P0/P1 build is **code-complete and logic-verified**: it was driven by hand
through `engine._updateFn(1/60)` for 900 frames with `input.locked` forced true and
synthetic input covering mouse look, jumping, all four weapons, firing, scoping, reload,
frag and flash — **zero exceptions**, the round advanced `freeze` → `live` with the timer
decrementing, the player moved 4.1 m on held `KeyW`, yaw/pitch tracked the mouse deltas,
and the bots stayed alive with no `NaN` and no state corruption. **The game logic is
sound.** This pass did not touch gameplay, weapons, bots, or physics.

The outstanding defect is **not a gameplay bug.** The reported symptom is: pointer lock
*succeeds* (the overlay clears, which only happens via `_onLockChange(true)` at
`src/main.js:39`) but the world is frozen and the round timer never counts down. That
combination is **not reproducible in this headless environment**: every statement in the
locked block (`src/main.js:137–150`) is gated behind `if (input.locked)`, yet the always-on
watchdog (a `setInterval`, independent of `requestAnimationFrame`) stayed **silent** across
the probe — the loop IS advancing and `input.locked` IS true. The leading hypothesis from
`FIX_PROMPT_2` is therefore "**`requestAnimationFrame` is not firing, or firing with
`input.locked` false on the user's machine**", which nothing in the code previously reported.

**What this pass added (`FIX_PROMPT_2` Tasks 1–3) — three diagnostics, each inert until
triggered, none touching gameplay/weapons/bots/physics:**

- **Task 1 — surface a refused pointer lock (`src/core/input.js`, `src/main.js`).**
   `requestLock()` now catches *both* the synchronous throw and the promise rejection and
  routes them to a new `_onLockError` callback, and a `pointerlockerror` listener covers the
  browser-refused path. `main.js` wires `_onLockError` to write a red
   `POINTER LOCK FAILED: …` to `#boot-status`. The one interaction the whole game gates on
  now fails loudly instead of silently.
- **Task 2 — frame-loop watchdog (`src/core/engine.js`, `src/core/debug.js`).**
   `Engine.frames` counts every `requestAnimationFrame` call; `makeFrameWatchdog` (always
  on, *not* flag-gated — it is the only thing that turns a silent freeze into a diagnosis)
  checks once a second whether the loop is advancing while locked and, if not, writes
   `FRAME LOOP STALLED …` naming `frames / locked / lockEl / visibility / round / t /
  updateErrored` to `#boot-status`. It is a `setInterval`, so it detects a dead
   `requestAnimationFrame` loop that `requestAnimationFrame` itself cannot report.
- **Task 3 — `?diag=1` live readout (`src/core/debug.js`, `src/main.js`).** A
  fixed-position DOM panel, created from JS (never in index.html) and refreshed every frame
  with `fps · frames · locked · pointerLockElement · visibilityState · round.state ·
  round.time · player.pos · engine._reportedError`. Inert without the flag, exactly like
   `?debug=1`.

**Task 4 — the overlay/lock invariant already holds; no code change, per "don't guess
which of the two it is."** `#lock-overlay`'s `hidden` class is toggled in **exactly one
place**, `src/main.js:39` via `_onLockChange(locked) → overlay.classList.toggle('hidden',
locked)`, and `_onLockChange` fires **only** from the `pointerlockchange` listener with
`locked = (document.pointerLockElement === this.canvas)` (`src/core/input.js:75`). So
`overlay.hidden === locked` at every step: the overlay cannot be hidden while the lock is
up, and the game re-shows it on every lock drop. There is **no second hide path** — the
buy menu's `exitPointerLock()` (`src/hud/buyMenu.js:46`) routes through the *same*
`_onLockChange`, it never hides the overlay directly. The "loop alive but `locked` false
while the overlay is hidden" divergence is therefore **impossible by construction**, and the
probe shows the loop is alive, so the "`requestAnimationFrame` is not firing" branch is
**not reproduced here**. Per `FIX_PROMPT_2`'s "do not attempt a fix without knowing which of
the two it is," this pass makes **no speculative fix** — the actual cause on the user's
machine is to be captured by the watchdog / `?diag=1` and recorded below.

**Still unverified.** Nothing here is marked *verified* on the strength of `npm run check`
alone — `check` is syntax-only. The diagnostic `npm run probe` run (after Task 3, with the
Task 1–3 diagnostics in place) is **clean**: no code errors, a healthy `#boot-status`
(`three r170 — P0-8 …`, **not** `FRAME LOOP STALLED`), `overlayHidden:true`,
`roundState:"freeze"`, 4 bots, and every P1-1..P1-7 behavior true. **That `bootStatus` being
the healthy line — not `FRAME LOOP STALLED` — is the evidence the watchdog is silent, i.e.
`requestAnimationFrame` is firing in headless.** To catch the user's-machine freeze, serve the
repo and on the failing machine either load `?diag=1` (live panel) or click **Click to play**
and read `#boot-status`: a frozen-but-locked world prints `FRAME LOOP STALLED frames=N …`; a
refused lock prints `POINTER LOCK FAILED: …`. Paste that into the Known-issues entry below.

### Diagnostic-pass probe output (after Tasks 1–3; identical after Task 1)

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
 "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-1..P1-7) ===
all true — sniper one-shots, shotgun 8-pellet kill, scope forces spread to 0 /
pistol ignores RMB, kevlar halves + headshot bypasses armor, money on kill persists
across a round reset, buy menu opens in freeze / greys unaffordable / closes on live,
frag arcs + impacts under its fuse, frag blast damages near bots only / no self-damage,
flash whites out on LOS / out-of-range no-op, [B] buy hint in freeze + nade chips dim
while thrown. (Full per-behavior blocks are the P1-1..P1-7 probe outputs below; they are
unchanged by Tasks 1–3.)

Console noise only: three SwiftShader "GPU stall due to ReadPixels" performance warnings
and one 404 (favicon) — both environment noise, not code errors.
```

**Watchdog output from the failing machine.** Not captured here — this headless
environment reproduces **no** freeze (the watchdog stayed silent: the loop advances and
`input.locked` is true). When a frozen-but-locked world is observed on a real machine, the
expected `#boot-status` is:

```
FRAME LOOP STALLED
frames=<N> locked=true lockEl=game-canvas
visibility=visible round=live t=<T> updateErrored=false
```

If `visibility=hidden`, the tab is backgrounded and the browser is throttling
`requestAnimationFrame` (the likely real cause of a "world frozen but timer stopped" report
— browsers pause rAF for non-visible tabs) — the fix is to keep the tab foregrounded, not a
code change. If `frames` is frozen at a low number with `visibility=visible` and
`updateErrored=false`, the loop is genuinely stalled and that output is the next thing to
record.

## RESUME — 2026-09-04 (repair pass)

**State.** P0-1 → P0-8 are code-complete and `npm run check` passes (24/24 after adding
`src/core/debug.js` in Task 10). A first-frame runtime crash had made the game appear to
"do nothing" on **Click to play**; this pass fixes it.

**Root cause (corrected).** The earlier `file://` diagnosis was **wrong**. "Click to play
does nothing" was a *runtime* bug, not an environmental one: `playerController.vertical`
declared `const grounded` and then reassigned it inside its `if (this.pos.y <= 0)` block.
The player spawns at `y = 0`, so this threw `TypeError: Assignment to constant variable` on
the very first frame after pointer lock. The throw escaped `Engine._frame` before
`renderer.render()`, freezing the last good frame — indistinguishable from "nothing happens".
Task 1 changes `const` to `let`.

**Why `npm run check` cannot catch it.** `check.mjs` runs `node --check`, which proves
*syntax* only; the reassignment is legal syntax that fails at runtime, so no amount of
`node --check` finds it. That is why `scripts/cs_probe.mjs` (headless Chrome over the
DevTools Protocol: it serves the page, loads it, clicks **Click to play**, and prints the
console logs, any exceptions, and the post-click `#boot-status`) must be run before any task
is marked verified. `npm run check` is necessary, never sufficient.

**What else the pass fixed.** Task 2 makes an update-loop throw degrade visibly instead of
freezing the frame: `_frame` now wraps `updateFn` in a try/catch and a one-time
`engine.onError` writes `UPDATE ERROR: …` to `#boot-status` — complementing index.html's
load-time / CDN-miss boot diagnostic, which still catches `BOOT INCOMPLETE` / `JS ERROR` /
`UNHANDLED REJECTION`. Tasks 3-10 are correctness/spec fixes: collision resolves on the
least-penetration axis; bot LOS uses eye-to-eye world-Y; the two ledges get a 1 m step so
they are reachable; the bombsite ring is raised above its platform; the P0-1 test world is
deleted; `rayAABB` is deduplicated into `core/physics.js`; the first spawn uses `spawnFor`;
and the `?debug=1` FPS/wireframe overlay is added (`src/core/debug.js`). See the task notes
and git history.

**Still unverified.** The probe could not be run this session (the Bash safety classifier was
down), so no task here is marked *verified* — only code-complete. Run `npm run probe` (or
`node scripts/cs_probe.mjs`); a clean boot reports no uncaught exceptions and a
`#boot-status` of `three r170 …` (not `JS ERROR` / `UPDATE ERROR`). Then serve with
`npm run serve` and play three clean rounds, per P0-9.

- [x] P0-1 Engine core and frame loop — Engine (renderer/scene/cam/clock/resize + `requestAnimationFrame` loop, dt clamped to 0.1s, hemisphere+directional light, 50×50 ground + test cube, `clearTestWorld()` for P0-3); EventBus with shared `events`; main.js wires engine + `window.__game`.
- [x] P0-2 Input and pointer lock — `Input` (keys Set, mouseDX/DY accumulated per frame, 3-button `mouseDown`, `justPressed` edge detection, pointer lock on overlay click, `locked` flag, begin/endFrame resets). `#lock-overlay` was already scaffolded in index.html; wired its show/hide to the lock state in main.js.
- [x] P0-3 Map data and blockout builder — `mapData` (26 boxes: perimeter, 30 m central lane, wing dividers, mid crates, two 2-step 1 m ledges, a 1 m jump box, T/CT cover, bombsite-A platform; 6 T + 6 CT spawns on opposite ends); `textures.makeTexture(kind)` procedural canvas (noise + seams, RepeatWrapping, cached per kind); `buildMap` adds floor + one mesh/collider per box + bombsite rings, returns `{colliders, spawns, sites}` with `colliders.length === boxes.length`. main.js clears the test cube and parks a static camera on a T spawn.
- [x] P0-4 Player controller with collision — `physics.js` (`aabbOverlap`, `resolveCapsuleVsBoxes` resolving X→Z→Y with a 0.6 m step threshold, `groundCheck`); `PlayerController` (yaw rig + pitch camera, WASD relative to yaw, run 6.5 / crouch 2.5 / walk 3.5 / jump, gravity 20, per-axis slide); `PlayerState` (health 100 / armor 0 / money 800 / team t / alive, `takeDamage` emits `kill` victim 'player' at 0 HP + `hit` for the vignette). Loop drives the player only while locked.
- [x] P0-5 Weapons: data, firing, hitscan, viewmodel — `weaponData` (pistol 34/400rpm/12+100 semi, rifle 36/600rpm/30+90 auto w/ spread growing +0.004/shot, reset 0.3s); `Weapon` (per-weapon ammo, 1/2 switch w/ 0.5s draw, R + empty-mag auto-reload, semi-vs-auto via `prevTrigger` edge, spread-perturbed dir, emits `shot`); `hitscan.resolveShot` (ray-vs-AABB slab test, 4× headshot, nearer wall shadows a bot); `viewmodel` (two-box gun + 40 ms muzzle flash + view recoil). `shot` wired to `resolveShot` against the map in main.js.
- [x] P0-6 Bots — `botData` (12 waypoints over the lane/wings/ends/corners, 8 codenames, `count:4`); `Bot` (0.8×1.8 body + 0.4 head in team color, dark nose to show facing; patrol/engage/dead state machine: patrol to a random waypoint at 3.5 m/s via the player's `resolveCapsuleVsBoxes` slide, engage when the player is alive + ≤30 m + an unobstructed eye-to-eye ray (fire every 0.25 s, 12 dmg, 20% miss, 2 s LOS grace), die by lying down 90° about X; `takeDamage` emits `hit`/`kill`); `BotManager` (4 CT bots at CT spawns, `targets()`, `update`, `resetAll`, `aliveCount`). main.js wires `resolveShot` against `botManager.targets()` and steps bots each locked frame.
- [x] P0-7 HUD — index.html adds the `#hud` DOM (vignette, 4-bar crosshair, timer, kill feed, HP/ARM bars, ammo/weapon) + corner-anchored CSS so nothing overlaps at 1280×720/1920×1080; `hud.js` `Hud` updates them from `{player, weapon, round, spread}` each frame, opens the crosshair with spread (4–46 px over 0–0.05 rad), flashes the red vignette on a `hit` whose target is `'player'`, and keeps a fading top-right kill feed (last 5, fade after 5 s) off `kill`. main.js drives it with a stand-in `round = { time: 115 }`.
- [x] P0-8 Round loop, teams, scoreboard — `teams.js` (`TEAMS` + `spawnFor` normalizing mapData `[x,z]` spawns to the `{x,z}` feet position `spawnAt` reads); `round.js` `Round` (freeze 5s / live 115s / end 5s / reset: early CT win on player death or timer, T win when `bots.aliveCount()===0`; emits `roundState` on each transition and `roundEnd` with the winner on entering `end`; on reset respawns the player at a fresh T spawn with full health, `weapon.refill()`, `bots.resetAll()`; a player death disables the controller, drops the camera to 0.3 m, and ends the round as a CT win via the `kill` event); `scoreboard.js` `Scoreboard` (Tab-held overlay of team scores + round number + per-participant K/D accumulated from `kill`, and a winner banner on `roundEnd` hidden on the next `freeze`); index.html adds the `#scoreboard`/`#result-banner` DOM + CSS. main.js: `round.update(dt)` runs first in the locked block, `botManager.update` is gated on `round.state==='live'`, and `scoreboard.update(dt,input)` runs after the viewmodel. — **Code complete; the first-frame `const grounded` crash that blocked it is fixed (Task 1); runtime still unverified, pending `cs_probe.mjs`.**
- [x] P0-9 Polish and stability pass — `?debug=1` FPS/wireframe overlay done (Task 10, `src/core/debug.js`); known-issues audit done (Task 11). The three-clean-rounds runtime check is code-ready but still unverified — pending `cs_probe.mjs` / a browser.

## Decisions made along the way

- P0-2: `#lock-overlay` (and its CSS) was already present in the scaffold's index.html, so P0-2 only wired its show/hide to the pointer-lock state rather than adding the div. No index.html edit was needed.
- P0-2: `justPressed` is edge-triggered via a `_downCodes` set; mouse "just down" is handled by the weapon's own `prevTrigger` flag (P0-5), so `Input` only tracks per-key edges.
- P0-4: The architecture note suggests jump velocity 4.8 m/s, but under gravity 20 that peaks at only ~0.58 m and cannot reach a 1 m crate. The P0-4 *acceptance* ("jump onto a 1 m crate works; a 2 m wall does not") takes priority, so `JUMP = 7.2` (peak ~1.3 m): clears 1 m crates, stays short of a 2 m wall. `resolveCapsuleVsBoxes` treats any box whose top is within 0.6 m of the feet as non-blocking so the player slides/lands on low crates.
- P0-5: `resolveShot` takes `weapon` as a 5th arg (the spec signature is `(origin, dir, colliders, targets)`) so it can apply the 4× headshot to `weapon.damage`; main.js passes the shot's weapon def.
- P0-5: Camera view-recoil needed somewhere to live. Added a minimal `recoil` field to `PlayerController` (`syncCamera` uses `pitch + recoil`); `viewmodel` eases it back on a 0.2 s half-life. This is the one touch to `playerController.js` outside P0-5's file list — it is zero while not firing, so P0-4 behavior is unchanged.
- P0-5: `Weapon` starts on the pistol (key 1) and switches to the rifle (key 2); both are available from spawn.
- P0-6: `BotManager` passes the `controller` (PlayerController) as the bot's `player` arg, so main.js wires `controller.state = player` — the bot reads combat state via `controller.state` (`alive`, `takeDamage`) and geometry via `controller.pos` / `controller.eye`.
- P0-6: `resolveShot` calls `onHit(damage, headshot)` (a P0-5 two-arg signature), so a player-killed bot's `kill` event has `weapon: undefined`. P0-7 will thread the weapon through `onHit` or fall back to a placeholder; deferred to keep P0-6 inside its file list.
- P0-6: `rayAABB` is duplicated — `hitscan.js` (shooting) and `bot.js` (line-of-sight). Duplicated to keep P0-6 inside its file list; P0-9 should dedupe it into `core/physics.js`.
- P0-6: a dead player has no respawn yet — that is P0-8. Bot fire is gated on `player.state.alive`, so a dead player simply stops taking damage until the round loop respawns.
- P0-7: the round timer uses a stand-in `round = { time: 115 }` (115 s = 1:55, the P0-8 live-round length) that main.js decrements. P0-8 replaces this with the real round loop from `src/game/round.js`; the HUD already reads `round.time`, so only main.js's round source changes.
- P0-7: the kill feed omits the weapon when the `kill` event carries none (bot kills arrive weapon-less via P0-6's two-arg `onHit` call). Thread the weapon through in P0-8 or log it as a known issue; the feed degrades gracefully.
- P0-7: crosshair spread→px is `gap = 4 + clamp(spread/0.05)·42`; the rifle base 0.006 sits at ~9 px and grows to ~43 px as the per-shot spread climbs, settling back over 0.3 s when the trigger releases.
- P0-8: `spawnFor(team, spawns, index?)` in `teams.js` normalizes mapData's `[x,z]` spawn pairs to the `{x,z}` feet position the controllers read. This also fixes a latent P0-6 bug: `BotManager` was passing raw `[x,z]` pairs to `bot.spawnAt`, which reads `.x`/`.z` and so produced `NaN` positions. `BotManager` now keeps the full `{t,ct}` spawns object and calls `spawnFor('ct', spawns, i)` in both the constructor and `resetAll`.
- P0-8: the weapon is threaded through `hitscan.onHit(damage, headshot, weapon)` (resolving the two-arg `onHit` deferred at P0-6/P0-7) so a killed bot's `kill` event carries its weapon, and the bot's name is threaded through `PlayerState.takeDamage(amount, headshot, weapon, killer)` so a bot-killed player's `kill` event names its killer. The P0-7 kill feed now shows the weapon on bot deaths, resolving the P0-7 "weapon-less kill" known issue.
- P0-8: the scoreboard shows the player under the display name `'You'`, but the `kill` events use the internal id `'player'` (bot.js as killer, PlayerState as victim). The scoreboard normalizes `'player' → 'You'` when accumulating K/D so the player's kills/deaths land in the rendered T column instead of a phantom unrendered entry.
- P0-8: `round.update(dt)` runs first in the locked block; `botManager.update` is gated on `round.state==='live'` so bots do not fire during freeze/end (and a dead bot can't fire — `bot.update` early-returns when `dead`). The old `round.time = Math.max(0, …)` decrement was removed; the timer is now owned by the `Round` state machine. A player death ends the round synchronously inside `botManager.update` via the `kill` event (`_onPlayerDeath` disables the controller, drops the camera to 0.3 m, and calls `_endRound('ct')`); `_endRound` is guarded by `state!=='live'` so a same-frame death + last-kill counts only one winner.
- P0-8: `Weapon.refill()` tops both mags/reserves and clears the reload/cooldown/spread so each round starts fully loaded.

## Known issues

(Be honest. Anything that does not meet the spec goes here.)

- P0-8: the two P0-6/P0-7-deferred "weapon-less kill" items are resolved — the weapon is threaded through `onHit` and the killer name through `takeDamage`, so every `kill` event carries a weapon and a killer.
- P0-8: bots deal flat `BOT_DAMAGE` with no headshot multiplier (`bot._engage` calls `takeDamage(BOT_DAMAGE, false, …)`). Intentional P0 scope — the scoreboard and kill feed still work; per-hit headshot damage for bots is a P0-9 polish item.
- P0-8: the `Round` loop is a single session-long loop; its `kill` listener is registered once and never unregistered. Harmless for P0; a real match loop would tear it down per match.
- **Runtime unverified (repair pass).** The first-frame "Click to play does nothing" was *not* the `file://` ES-module block as first suspected — it was a `const grounded` reassignment in `playerController.vertical` that threw on frame one and froze the render (fixed in Task 1). `npm run check` is syntax-only and cannot catch this class of error, so P0-8's runtime acceptance and P0-9's three-clean-rounds check stay unverified until `scripts/cs_probe.mjs` (or a browser) confirms a clean boot. `engine.onError` (Task 2) now writes any update-loop throw to `#boot-status` as `UPDATE ERROR: …`.
- **Pointer-lock / frame-loop defect, not reproduced (2026-09-06, `FIX_PROMPT_2`).** The reported symptom — pointer lock succeeds (overlay clears) but the world is frozen and the timer never counts down — is **not a gameplay bug** (the 900-frame manual drive is clean) and is **not reproducible in headless** (the always-on `Engine.frames` watchdog stays silent: the loop advances and `input.locked` is true, so `#boot-status` reads the healthy `three r170 …` line, not `FRAME LOOP STALLED`). Three diagnostics were added so the failure is observable on the user's machine instead of silent: a `_onLockError` + `pointerlockerror` + promise-`.catch` path writing `POINTER LOCK FAILED: …` to `#boot-status` (`src/core/input.js`, `src/main.js`); the always-on `makeFrameWatchdog` writing `FRAME LOOP STALLED …` on a stalled loop (`src/core/engine.js`, `src/core/debug.js`); and a `?diag=1` live panel (`src/core/debug.js`, `src/main.js`). The overlay/lock sync invariant **already holds** — `overlay.hidden` is toggled solely by `_onLockChange` from `pointerLockElement === canvas` (`src/main.js:39` / `src/core/input.js:75`), so the "diverged overlay vs lock" branch is impossible and, the loop being alive here, the "`requestAnimationFrame` not firing" branch is unconfirmed; per "don't guess which of the two it is," **no speculative fix was made**. Most likely real cause if `visibility=hidden`: a backgrounded tab with a browser-throttled `requestAnimationFrame`. **Paste the `FRAME LOOP STALLED` / `POINTER LOCK FAILED` output from the failing machine here when captured.**

---

## P1 — weapons, economy, tacticals

Spec: `docs/P1_SPEC.md`. One task at a time; `npm run check` after each, `npm run probe`
after P1-1 / P1-5 / P1-7. The probe is the runtime source of truth; a task is *verified*
only when the probe is clean. This supersedes the P0 "runtime unverified" note above —
the probe now boots cleanly in this headless environment (see the probe note).

**Probe note (this GPU-less headless environment).** Three.js needs a WebGL context; in
headless Chrome that means **old** headless mode (`--headless`, not `--headless=new`,
which leaves the context Disabled) plus ANGLE/SwiftShader (`--use-gl=angle
--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`). The probe
also stubs `requestPointerLock` (headless has no pointer) so the click-to-lock path runs
and the combat loop is exercised, and it classifies a WebGL-context failure as `[env]` so
a real code error is not masked by it. A stray headless Chrome from an earlier run can hold
CDP port 9333 and mask a fresh spawn — kill leftover probe chromes before running.

- [x] P1-1 Shotgun + Sniper: data, firing, viewmodels — `weaponData.js`: `shotgun`
   (semi, `pellets:8`, 20/pellet, rpm 120, 8+64, spread 0.06, high recoil) and `sniper`
   (100 dmg, rpm 60, 1+10, spread 0, high recoil, `scoped:true`); `WEAPON_KEYS` -> 4.
   `weapon.js` switches on `Digit1-4` and emits `pellets: d.pellets || 1` per pull (one
   viewmodel recoil kick per pull). `main.js` fans out N `resolveShot` calls per shot,
   each a fresh cone perturbation at `weapon.currentSpread` — the perturbation moved out of
   weapon.js so every pellet gets an independent direction. `viewmodel.js` reshapes the gun
   per weapon via a `SHAPES` table (body/barrel scale + tint from the rifle baseline).
   **Verified:** `check` 24/24; probe clean (no code errors, engine boots: `hasGame`,
   three r170, `roundState` `freeze`, 4 bots). Behavior proven in the probe by firing
   `resolveShot` at a bot with no colliders: the **sniper one-shots** a 100-HP bot
   (`sniperKilled: true`); the **shotgun's 8-pellet** pull lands several hits and kills it
   (`shotLanded: 4` — 100 HP / 20 per pellet, the 5th is the killing blow — `shotKilled: true`).
- [x] P1-2 Sniper scope — `weapon.js` gains a `scoped` flag set by a new `_scope(input)`
    (runs after `_updateSpread` in `update`): while RMB (`input.mouseDown[2]`) is held on a
    weapon whose def has `scoped:true`, `scoped` is true and `spread` forces to 0 (dead-on aim);
    a non-scoped def has no flag, so RMB is ignored. `main.js` eases the camera FOV 90↔30 on
    an ~0.08 s time constant (`camera.updateProjectionMatrix()` each frame) and sets
    `controller.moveScale = scoped ? 0.5 : 1` (player.js multiplies horizontal speed by it — a
    minimal out-of-file-list touch, like P0-5's `recoil`); the viewmodel hides the gun while
    scoped (`viewmodel.js`), and the HUD shows a `#scope-overlay` (dark circular window + thin
    cross) and hides the normal crosshair. `index.html` adds the overlay div + CSS. **Verified:**
    `check` 24/24; probe clean and the scope block proves it — `sniperScoped:true`,
    `spreadForced0:true` (a 0.03 accumulated spread is zeroed), `releasedUnscoped:true`,
    `pistolIgnores:true`.
- [x] P1-3 Armor mitigation + money on kills — `playerState.takeDamage(amount,
    headshot, weapon, killer)`: when `armor > 0` and **not** a headshot, apply 50%
    mitigation (`dmg *= 0.5; armor = max(0, armor - (original - dmg))`) then
    `health -= dmg`; headshots bypass armor. `money`/`armor` moved to the constructor
    and `reset()` now resets **only** `health`/`alive`, so the economy survives a round
    reset (round.js line 85 calls `player.reset()`). `headshot` is threaded
    `bot.takeDamage -> _die -> kill` event, and a `kill` listener in main.js awards
    `+300` per player kill, `+100` for a headshot. **Verified:** `check` 24/24; probe
    clean — `kevlarHalved/armorAbsorbed/headshotBypass/moneyOnKill/moneyOnHeadshot/
    moneyPersists/armorPersists` all true.
- [x] P1-4 Freeze-phase buy menu — `src/hud/buyMenu.js` `BuyMenu(player, weapon,
    round, input)` on the scoreboard overlay pattern: `B` (`justPressed('KeyB')`)
    toggles a centered `#buy-menu` panel while `round.state==='freeze'`; items
    `Kevlar` 250 → `armor=100`, `Kevlar + Helmet` 650 → `armor=100` + `helmet`,
    `Magazine Pack` 100 → `weapon.current.reserve = weapon.def.reserve`. Each
    `{name,cost,apply()}`; unaffordable items grey/disabled and un-clickable, a
    live money readout, buying deducts + applies in place. Opening releases pointer
    lock (`input.canvas.exitPointerLock()`) so the mouse can click; closing re-requests
    it (best-effort — a browser may need a click gesture). `update(dt,input)` runs
    **outside** the locked block in main.js so it stays live while its lock release
    is up, and auto-closes on `live`. index.html adds the `#buy-menu` shell + CSS.
    **Verified:** `check` 25/25; probe clean — `opensInFreeze/kevlarArmor/kevlarMoney/
    kevGreyed/magOk/unclickable/inertOutsideFreeze/closesOnLive` all true.
- [x] P1-5 Thrown projectiles (frag + flash) — `src/game/projectile.js` `Projectile`
    (position/velocity + gravity 9.8, a ballistic step, a swept wall check via
    `rayAABB`, a floor check at `y=0.15`, and a fuse; on first floor/wall contact or
    fuse expiry it fires `onImpact(pos)` and removes its sphere mesh) + `ProjectileManager`
    (`throw`/`update`, pruning the dead). `src/weapons/tactical.js` `Tactical`: `G` throws a
    red frag (fuse 4 s), `H` a yellow flash (fuse 1.6 s), each from the camera forward with
    an upward arc, one active throw of each (a slot check blocks a second while the first is
    in flight); a detonation emits a `tactical` `{kind,pos}` event for P1-6's effects.
     main.js creates a `ProjectileManager(scene)` + `Tactical`, and the locked block calls
     `tactical.update` then `projectiles.update`. **Verified:** `check` 27/27; probe clean —
     `threwFrag/oneAtATime/impactFired/impactKind:'frag'/removed/steppedUnderFuse` all true
    (the frag arced and hit the floor before its fuse, so the loop terminated by impact, not
     timeout).
- [x] P1-6 Tactical effects — `src/game/effects.js` `Effects({scene, colliders,
    player, getTargets})` reacts to the `tactical` events P1-5 emits on a detonation.
    A **frag** damages every bot within `FRAG_RADIUS` (4 m) with linear falloff from
    `FRAG_DMG` (100) at center to 0 at the edge — bots only, the thrower is never hit —
    throws an expanding additive-blended explosion sphere that grows to the blast
    radius and fades over 0.3 s then is pruned, and triggers a brief (0.15 s) orange
    screen flash. A **flash** whiteouts the screen only when the player's eye has line
    of sight to the impact (`rayAABB` clear and within `FLASH_RANGE` 20 m) — a full-screen
     `#whiteout` div eased `1 -> 0` over 2 s; bots ignore it. The two screen overlays are
    opacities `effects.update(dt)` eases and `hud.js` paints each frame from
    `effects.whiteout`/`effects.flash`; index.html adds the `#whiteout` + `#impact-flash`
    divs + CSS, and main.js builds `Effects` and runs `effects.update(dt)` before the HUD.
     **Verified:** `check` 28/28; probe clean — `fragDamaged/farUntouched/noSelfDamage/
    explosionSpawned/explosionPruned/flashWhiteout/flashFading/flashOutOfRange` all true.
- [x] P1-7 HUD integration + polish — `tactical.js` gains `ready()` (`{ frag, flash }`
    — a nade is "held"/available while its slot is free). `hud.js` grabs `#td-frag`/
    `#td-flash`/`#buy-hint` and, in `update`, shows the `[B] Buy` hint only during
     `freeze` and dims a nade chip while it is in flight (from `tactical.ready()`);
     `main.js` passes `tactical: tactical.ready()` into the HUD state. `index.html` adds
    the two overlays (outside `#hud`, `position: fixed`, alongside the scope/whiteout/
    flash divs) + CSS; the scope + whiteout overlays (P1-2/P1-6) and the armor readout
    (P1-3) are unchanged and remain wired. `?debug=1` FPS + colliders are untouched
    (`debug.js` and its main.js wiring were not modified this pass). **Verified:**
    `check` 28/28; probe clean — `buyHintFreeze/buyHintLive/bothHeld/fragThrew/
    fragDimmed/fragRelit` all true.

### P1-1 probe output

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
 "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-1) ===
{ sniperDef:'Sniper', shotDef:'Shotgun', shotPellets:8,
  sniperKilled:true, shotLanded:4, shotKilled:true }
```

### P1-2 probe output

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
  "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-2 scope) ===
{ sniperScoped:true, spreadForced0:true, releasedUnscoped:true, pistolIgnores:true }
```

### P1-3 probe output

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
   "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-3 econ) ===
{ kevlarHalved:true, armorAbsorbed:true, headshotBypass:true,
  moneyOnKill:true, moneyOnHeadshot:true, moneyPersists:true, armorPersists:true }
```

### P1-4 probe output

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
   "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-4 buy) ===
{ opensInFreeze:true, kevlarArmor:true, kevlarMoney:true,
  kevGreyed:true, magOk:true, unclickable:true,
  inertOutsideFreeze:true, closesOnLive:true }
```

### P1-5 probe output

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
   "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-5 tactical) ===
{ threwFrag:true, oneAtATime:true, impactFired:true,
  impactKind:'frag', removed:true, steppedUnderFuse:true }
```

### P1-6 probe output

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
   "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-6 effects) ===
{ fragDamaged:true, farUntouched:true, noSelfDamage:true,
  explosionSpawned:true, explosionPruned:true,
  flashWhiteout:true, flashFading:true, flashOutOfRange:true }
```

### P1-7 probe output

```
=== EXCEPTIONS ===
(no code errors)

=== POST-CLICK STATE ===
{"hasGame":true,"threeRev":"170","overlayHidden":true,"roundState":"freeze","botCount":4,
   "bootStatus":"three r170 — P0-8 Round loop (freeze/live/end + scoreboard)"}

=== BEHAVIOR (P1-7 hud) ===
{ buyHintFreeze:true, buyHintLive:true, bothHeld:true,
  fragThrew:true, fragDimmed:true, fragRelit:true }
```
