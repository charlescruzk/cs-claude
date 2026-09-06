# P0 Specification — single-player vs bots, one map

Tasks are in execution order. Each one leaves the game runnable. Each lists the files it
touches, what to build, and the acceptance criteria that define "done." Read
`docs/ARCHITECTURE.md` for the conventions every task assumes.

Do not implement anything from a later task early.

---

## P0-1 — Engine core and frame loop

**Files:** `src/core/engine.js`, `src/core/events.js`, `src/main.js`

Build the `Engine` class: WebGL renderer attached to `#game-canvas`, a `Scene`, a
`PerspectiveCamera` (FOV 90, near 0.05, far 500), a `Clock`, window resize handling, and
a `start(updateFn)` method that runs `requestAnimationFrame`, computes `dt` (clamped to
0.1 s max), calls `updateFn(dt)`, then renders. Add a hemisphere light plus a directional
light. Add a 50 × 50 ground plane and one test cube so something is visible.

Build `EventBus` in `events.js`: `on(name, fn)`, `off(name, fn)`, `emit(name, payload)`.
Export a single shared instance as `events`.

Update `main.js` to construct the Engine and start the loop. Set `window.__game`.

**Done when:**
- Page shows a lit ground plane and cube with no console errors.
- Resizing the window keeps the aspect ratio correct.
- `window.__game.engine` exists.

---

## P0-2 — Input and pointer lock

**Files:** `src/core/input.js`, `src/main.js`, `index.html`

Build `Input`: tracks `keys` (Set of `event.code`), `mouseDX/mouseDY` accumulated per
frame, `mouseDown` for buttons 0 and 2, and `justPressed(code)` which is true only on the
frame the key went down. Request pointer lock on canvas click; expose `input.locked`.
`beginFrame()` and `endFrame()` reset per-frame values.

Add a `#lock-overlay` div in `index.html` reading "Click to play" that hides when locked
and reappears when pointer lock is lost.

**Done when:**
- Clicking the canvas locks the pointer and hides the overlay; Esc shows it again.
- `window.__game.input.keys` reflects held keys.
- `mouseDX` is non-zero while moving the mouse and zero on frames with no movement.

---

## P0-3 — Map data and blockout builder

**Files:** `src/map/mapData.js`, `src/map/textures.js`, `src/map/mapBuilder.js`, `src/main.js`

`mapData.js` exports a plain object: `{ boxes: [...], spawns: { t: [...], ct: [...] }, sites: [...] }`.
Each box is `{ pos: [x,y,z], size: [w,h,d], tex: 'sand'|'concrete'|'crate' }`. Author a
dust-inspired layout roughly 60 × 60 m: outer walls, a long corridor, a mid area with
crates, two elevated ledges reachable by ramps or stacked boxes, one open plaza marked as
bombsite A. At least 5 T spawns and 5 CT spawns on opposite ends. Keep it under 80 boxes.

`textures.js` exports `makeTexture(kind)` returning a `THREE.CanvasTexture` drawn
procedurally (noise + a few lines), tinted per kind, with `RepeatWrapping`.

`mapBuilder.js` exports `buildMap(mapData, scene)` returning `{ colliders, spawns, sites }`
where each collider is `{ min: Vector3, max: Vector3 }`. Use one `BoxGeometry` mesh per
box and cache materials per texture kind. Remove the P0-1 test cube; keep a floor.

**Done when:**
- The map renders with visible variety between sand, concrete, and crate surfaces.
- `window.__game.map.colliders.length` equals the number of boxes.
- Spawns are inside the playable area (not inside a box).

---

## P0-4 — Player controller with collision

**Files:** `src/core/physics.js`, `src/player/playerController.js`, `src/player/playerState.js`, `src/main.js`

`physics.js`: `aabbOverlap(a, b)`, `resolveCapsuleVsBoxes(pos, radius, height, colliders)`
that pushes the player out of any overlapping box along the minimum axis, and a
`groundCheck` that returns whether the player is standing on a box top (or the floor
plane at y = 0).

`playerController.js`: `PlayerController(camera, input)`. Mouse look with yaw on a parent
object and pitch on the camera, pitch clamped to ±89°, sensitivity constant. WASD relative
to yaw, normalized diagonal, run speed 6.5, crouch (Ctrl) 2.5 with eye height 1.0,
walk (Shift) 3.5, jump (Space) only when grounded, gravity 20. Move per axis, resolve
collisions after each axis so sliding along walls works. Spawn at a random T spawn.

`playerState.js`: `{ health: 100, armor: 0, money: 800, team: 't', alive: true }` and
`takeDamage(amount)` that emits `kill` with `{ victim: 'player' }` when health hits 0.

**Done when:**
- You can walk the whole map, slide along walls, cannot pass through boxes, and cannot
  fall through the floor.
- Jumping onto a 1 m crate works; jumping onto a 2 m wall does not.
- Crouching lowers the view and slows movement; Ctrl under a low gap is not required.

---

## P0-5 — Weapons: data, firing, hitscan, viewmodel

**Files:** `src/weapons/weaponData.js`, `src/weapons/weapon.js`, `src/weapons/hitscan.js`, `src/weapons/viewmodel.js`, `src/main.js`

`weaponData.js`: two weapons. `pistol` — damage 34, rpm 400, mag 12, reserve 100,
spread 0.01, recoil 0.015, semi-auto. `rifle` — damage 36, rpm 600, mag 30, reserve 90,
spread 0.006 growing +0.004 per shot while held (reset 0.3 s after release), recoil
0.02, full-auto. Reload times 2.2 s and 2.5 s.

`weapon.js`: `Weapon(dataKey)`. Handles fire timing from rpm, semi vs auto using
`input.mouseDown[0]` and `justPressed`, reload on R (and auto when mag empty and trigger
pulled), ammo accounting, and emits `shot` with `{ origin, dir, weapon }` where `dir` is
the camera forward plus random spread. Number keys 1 and 2 switch weapons with a 0.5 s
draw time during which firing is blocked.

`hitscan.js`: `resolveShot(origin, dir, colliders, targets)` where targets is an array of
`{ box, headBox, onHit(damage, headshot) }`. Returns the nearest hit among map boxes and
targets using ray-vs-AABB slab tests. Headshot multiplier 4×. Emits `hit`.

`viewmodel.js`: a primitive gun (two boxes) parented to the camera at the lower right.
On `shot`, kick the gun back and up briefly and flash a small emissive sphere at the
muzzle for 40 ms. Pitch the camera up by the weapon's recoil per shot; recover half of it
over 0.2 s.

**Done when:**
- Left click fires with correct cadence for each weapon; rifle holds, pistol does not.
- Ammo decrements, R reloads, empty mag auto-reloads, reserve caps correctly.
- Recoil kicks the view and the gun visibly; muzzle flash is visible.
- A ray hitting a wall stops there (verify in P0-6 by shooting a bot behind a crate).

---

## P0-6 — Bots

**Files:** `src/bots/botData.js`, `src/bots/bot.js`, `src/bots/botManager.js`, `src/main.js`

`botData.js`: 12 waypoints covering the map, an array of 8 names, `count: 4`.

`bot.js`: `Bot(name, team, scene)`. Body box 0.8 × 1.8 × 0.8 in team color (CT blue,
T orange), head box 0.4 on top, a name sprite optional. State machine:
- `patrol`: walk between random waypoints at 3.5 m/s, turning toward the next one, with
  the same collision resolution as the player.
- `engage`: if the player is alive, within 30 m, and a ray from bot eye to player eye hits
  no map box, face the player and fire every 0.25 s with 12 damage and a 20% miss chance.
  Lose engagement after 2 s without line of sight.
- `dead`: lie the body down (rotate 90° about X) and stop updating for the round.
`takeDamage(amount, headshot)`; at 0 health emit `kill`.

`botManager.js`: spawns `count` bots on the CT team at CT spawns, exposes `targets()`
for hitscan, `update(dt, player, colliders)`, `resetAll()` to respawn everyone, and
`aliveCount()`.

Wire in `main.js`: on `shot`, call `resolveShot` with `botManager.targets()`.

**Done when:**
- Four blue bots patrol the map and do not walk through walls.
- Bots shoot at you when they can see you and stop when you break line of sight.
- Shooting a bot reduces its health; headshots kill in one rifle shot; dead bots fall.
- A bot behind a crate cannot be hit through the crate.

---

## P0-7 — HUD

**Files:** `src/hud/hud.js`, `index.html`, `src/main.js`

DOM HUD inside `#hud`: center crosshair (four gaps that widen with current spread),
bottom-left health and armor, bottom-right `mag / reserve` and weapon name, top-center
round timer `m:ss`, top-right kill feed (last 5 kills, fade after 5 s), a red vignette
flash on player damage. `hud.update({ player, weapon, round, spread })` once per frame.
Listen to `kill` and `hit` on the event bus.

**Done when:**
- All HUD elements show live values and nothing overlaps at 1280 × 720 or 1920 × 1080.
- Crosshair widens while firing the rifle and settles when you stop.
- Taking damage flashes the screen red.

---

## P0-8 — Round loop, teams, scoreboard

**Files:** `src/game/teams.js`, `src/game/round.js`, `src/hud/scoreboard.js`, `src/main.js`

`teams.js`: `TEAMS = { t, ct }`, colors, `spawnFor(team, spawns)`.

`round.js`: `Round()` state machine. `freeze` (5 s, player cannot move, can look and
switch weapons) → `live` (1 m 55 s) → `end` (5 s, shows winner) → reset. Live ends early
when the player dies (CT win) or all bots are dead (T win). Timer expiry is a CT win.
Emit `roundState` every state change and `roundEnd` with the winner. On reset: player
back to full health at a fresh T spawn, weapons refilled, bots respawned. Track score
per team and round number.

`scoreboard.js`: hold Tab to show a centered overlay with team scores, round number,
and each participant's kills/deaths.

Player death: on `kill` with victim `player`, disable the controller, drop the camera to
0.3 m, wait for round end.

**Done when:**
- A full round plays: freeze countdown, live play, winner banner, automatic restart.
- Killing all four bots ends the round as a T win and the score increments.
- Dying ends the round as a CT win; you respawn alive next round.
- Tab shows a correct scoreboard.

---

## P0-9 — Polish and stability pass

**Files:** any under `src/`, `docs/PROGRESS.md`

- Confirm no console errors across three consecutive rounds.
- Cap the frame `dt` and make sure tabbing away and back does not teleport anything.
- Add a `?debug=1` query flag that shows an FPS counter and wireframe colliders.
- Read every file in `src/` once and fix anything that violates `CLAUDE.md`
  (file length, globals, missing `dt`).
- Fill in the "Known issues" section of `docs/PROGRESS.md` honestly.

**Done when:** `npm run check` passes and `docs/PROGRESS.md` is complete and accurate.
