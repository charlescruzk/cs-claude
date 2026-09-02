# P0 Progress

Mark each task `[x]` when its acceptance criteria are met, `[!]` if blocked after two
attempts (write what you tried). Add a one-line note per task.

- [x] P0-1 Engine core and frame loop — Engine (renderer/scene/cam/clock/resize + `requestAnimationFrame` loop, dt clamped to 0.1s, hemisphere+directional light, 50×50 ground + test cube, `clearTestWorld()` for P0-3); EventBus with shared `events`; main.js wires engine + `window.__game`.
- [x] P0-2 Input and pointer lock — `Input` (keys Set, mouseDX/DY accumulated per frame, 3-button `mouseDown`, `justPressed` edge detection, pointer lock on overlay click, `locked` flag, begin/endFrame resets). `#lock-overlay` was already scaffolded in index.html; wired its show/hide to the lock state in main.js.
- [x] P0-3 Map data and blockout builder — `mapData` (26 boxes: perimeter, 30 m central lane, wing dividers, mid crates, two 2-step 1 m ledges, a 1 m jump box, T/CT cover, bombsite-A platform; 6 T + 6 CT spawns on opposite ends); `textures.makeTexture(kind)` procedural canvas (noise + seams, RepeatWrapping, cached per kind); `buildMap` adds floor + one mesh/collider per box + bombsite rings, returns `{colliders, spawns, sites}` with `colliders.length === boxes.length`. main.js clears the test cube and parks a static camera on a T spawn.
- [x] P0-4 Player controller with collision — `physics.js` (`aabbOverlap`, `resolveCapsuleVsBoxes` resolving X→Z→Y with a 0.6 m step threshold, `groundCheck`); `PlayerController` (yaw rig + pitch camera, WASD relative to yaw, run 6.5 / crouch 2.5 / walk 3.5 / jump, gravity 20, per-axis slide); `PlayerState` (health 100 / armor 0 / money 800 / team t / alive, `takeDamage` emits `kill` victim 'player' at 0 HP + `hit` for the vignette). Loop drives the player only while locked.
- [x] P0-5 Weapons: data, firing, hitscan, viewmodel — `weaponData` (pistol 34/400rpm/12+100 semi, rifle 36/600rpm/30+90 auto w/ spread growing +0.004/shot, reset 0.3s); `Weapon` (per-weapon ammo, 1/2 switch w/ 0.5s draw, R + empty-mag auto-reload, semi-vs-auto via `prevTrigger` edge, spread-perturbed dir, emits `shot`); `hitscan.resolveShot` (ray-vs-AABB slab test, 4× headshot, nearer wall shadows a bot); `viewmodel` (two-box gun + 40 ms muzzle flash + view recoil). `shot` wired to `resolveShot` against the map in main.js.
- [x] P0-6 Bots — `botData` (12 waypoints over the lane/wings/ends/corners, 8 codenames, `count:4`); `Bot` (0.8×1.8 body + 0.4 head in team color, dark nose to show facing; patrol/engage/dead state machine: patrol to a random waypoint at 3.5 m/s via the player's `resolveCapsuleVsBoxes` slide, engage when the player is alive + ≤30 m + an unobstructed eye-to-eye ray (fire every 0.25 s, 12 dmg, 20% miss, 2 s LOS grace), die by lying down 90° about X; `takeDamage` emits `hit`/`kill`); `BotManager` (4 CT bots at CT spawns, `targets()`, `update`, `resetAll`, `aliveCount`). main.js wires `resolveShot` against `botManager.targets()` and steps bots each locked frame.
- [ ] P0-7 HUD —
- [ ] P0-8 Round loop, teams, scoreboard —
- [ ] P0-9 Polish and stability pass —

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

## Known issues

(Be honest. Anything that does not meet the spec goes here.)
