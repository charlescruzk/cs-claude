# P1 Specification — weapon roster, buy economy, tacticals

Mirrors `docs/P0_SPEC.md` conventions. Tasks are in execution order; each leaves the
game runnable and ends with an acceptance check. Read `docs/ARCHITECTURE.md` and
`CLAUDE.md` first. One task at a time; do not skip ahead. After each task run
`npm run check` (syntax only) and, where noted, `npm run probe` (runtime — the source
of truth; a task is *verified* only when the probe is clean).

## Locked design (approved)
- **Weapons:** Pistol + Rifle + Shotgun + Sniper (4 weapons, keys 1-4).
- **Economy:** freeze-phase buy panel (B in `freeze`) — Kevlar, Kevlar+Helmet,
  Magazine Pack; money accrues from kills.
- **Tacticals:** thrown arcing projectiles — frag (radius/splash damage) and flash
  (whiteout). Player-only; bots ignore them.

## Global constraints (unchanged from CLAUDE.md)
Generic names only (Pistol/Rifle/Shotgun/Sniper/Frag/Flash — never AK/M4/AWP/Molotov).
No new deps, no build step, vanilla ES modules, Three.js from the importmap. New files
under `src/` only, each < 300 lines, one concern per file. Reuse `events.js`,
`rayAABB`/`aabbOverlap`, and the scoreboard overlay pattern. `npm run check` is
syntax-only; the runtime source of truth is `npm run probe`. No task is *verified* on
`check` alone.

---

## P1-1 — Shotgun + Sniper: data, firing, viewmodels
**Files:** `src/weapons/weaponData.js`, `src/weapons/weapon.js`, `src/weapons/hitscan.js`,
`src/weapons/viewmodel.js`, `src/main.js`
- `weaponData.js`: `WEAPON_KEYS` -> `['pistol','rifle','shotgun','sniper']`.
  `shotgun`: semi (`auto:false`), `pellets: 8`, per-pellet damage ~20, rpm ~120, mag 8
   / reserve 64, wide base spread ~0.06, high recoil. `sniper`: semi, damage 100
   (headshot instakill via the existing 4x), rpm ~60, mag 1 / reserve 10, spread ~0,
  very high recoil, and a `scoped: true` flag (consumed in P1-2).
- `weapon.js`: on a firing pull, emit **one** `shot` event carrying
   `pellets: d.pellets || 1` (viewmodel recoil fires once per pull). The shot handler
   in `main.js` fans out N `resolveShot` calls, each with a fresh direction perturbed
   by the weapon's live `weapon.currentSpread` (the perturbation moves out of `weapon.js`
   into the `main.js` handler so every pellet gets an independent cone direction).
   Extend `_switch` from `Digit1/2` to `Digit1-4`.
- `viewmodel.js`: vary the gun silhouette per weapon (barrel length/width/color) so
   pistol/rifle/shotgun/sniper read differently in first person.
**Done when:** 1-4 switch; a shotgun pull damages a bot in several points at once; a
sniper one-shots a bot; `npm run check` passes and the probe is clean.

## P1-2 — Sniper scope
**Files:** `src/weapons/weapon.js`, `src/weapons/viewmodel.js`, `src/main.js`,
`src/hud/hud.js`, `index.html`
- Hold **RMB** (`input.mouseDown[2]`) with the sniper equipped -> `scoped`. While
   scoped: camera FOV eases 90 -> ~30 (`camera.updateProjectionMatrix()` each frame),
   the normal crosshair hides and a thin scope cross shows, player move speed halved,
   and spread forced to ~0; release eases FOV back to 90. A scope overlay (dark circular
   vignette + thin crosshair) as a DOM div in `index.html`, shown/hidden by the hud.
   Only the sniper scopes; a non-sniper ignores RMB.
**Done when:** scoping zooms and lets you pick off a distant bot; unscoping restores
FOV 90; RMB with a non-sniper does nothing; probe clean.

## P1-3 — Armor mitigation + money on kills
**Files:** `src/player/playerState.js`, `src/main.js` (a `kill` listener),
`src/bots/bot.js` (thread `headshot` into the `kill` event)
- `PlayerState.takeDamage(amount, headshot, weapon, killer)`: when `armor > 0` and the
   hit is **not** a headshot, apply ~50% mitigation — `original = amount; amount *= 0.5;
   armor = max(0, armor - (original - amount))` — then `health -= amount`. Headshots
   bypass armor.
- On `kill` with `killer === 'player'`: award **+300 per kill, +100 headshot**. To make
   the +100 real, thread `headshot` through `bot._die`/`takeDamage` into the `kill`
   event payload.
- **Preserve the economy across rounds:** `PlayerState.reset()` resets **only**
   `health`/`alive`, leaving `money` and `armor` intact; the initial money/armor move to
   the constructor (today `reset()` zeroes `money` to 800 every round, erasing what the
   player just bought).
**Done when:** Kevlar halves bot damage; kills add money; a round reset does not wipe
money/armor.

## P1-4 — Freeze-phase buy menu
**Files:** `src/hud/buyMenu.js` (new), `index.html` (DOM shell + CSS), `src/main.js`
- `B` (`justPressed('KeyB')`) while `round.state === 'freeze'` toggles a centered DOM
   panel on the scoreboard overlay pattern. Items: **Kevlar** 250 -> `armor = 100`;
   **Kevlar + Helmet** 650 -> `armor = 100` (+ a `helmet` flag); **Magazine Pack** 100
   -> refill the **equipped** weapon's reserve to its max. Each item is
   `{ name, cost, apply() }`; grey out items the player cannot afford; show current
   money; buying deducts and applies immediately; the panel is disabled outside `freeze`
   and closes on B-again or automatically on `live`.
**Done when:** in `freeze` B opens the panel; buying Kevlar shows armor 100 and deducts
250; unaffordable items are greyed and un-clickable; the panel is inert and hidden
outside `freeze` and closes on `live`; probe clean.

## P1-5 — Thrown projectiles (frag + flash)
**Files:** `src/game/projectile.js` (new), `src/weapons/tactical.js` (new), `src/main.js`
- `Projectile`: position/velocity, gravity, integrate per `dt`, collide with the floor
   (`y = 0`) and the map colliders (swept/step AABB — reuse `aabbOverlap`/`rayAABB`),
   a fuse timer, and an `onImpact(pos)` callback on first solid contact or fuse expiry.
   A small mesh travels with it; a dead/fused projectile is removed from the scene.
- `Tactical`: `G` throws a **frag**, `H` throws a **flash** (documented; one active throw
   each). Each throw spawns from the camera forward with an initial velocity plus an
   upward arc. Wire `projectiles.update(dt)` into the locked loop block in `main.js`.
**Done when:** G/H throw an object that arcs, hits ground/wall, and fires its impact
handler (the probe logs it); a dead/fused projectile is removed; probe clean.

## P1-6 — Tactical effects
**Files:** `src/game/effects.js` (new), `src/main.js`, `index.html` (whiteout div),
`src/hud/hud.js`
- **Frag** on impact: an expanding emissive sphere mesh that fades over ~0.3 s, **radius
   damage** to every bot target within `R` (falloff by distance), and a brief full-screen
   orange flash. The frag does **not** self-damage the thrower; it damages bots.
- **Flash** on impact: if the player has line of sight to the impact point (`rayAABB`
   clear) and is within range, trigger a **whiteout** — a full-screen white div whose
   opacity eases `1 -> 0` over ~2 s. Bots ignore it (player-only).
**Done when:** a frag that lands near bots damages/kills them (probe: `aliveCount()`
drops); a flash that lands in front of the camera whiteouts the screen and fades; probe
clean.

## P1-7 — HUD integration + polish
**Files:** `src/hud/hud.js`, `index.html`, `src/main.js`, `docs/PROGRESS.md`
- HUD: show armor (present), a tactical indicator (frag/flash held), a `[B] Buy` hint
   during `freeze`, plus the scope and whiteout overlays. Confirm `?debug=1` still shows
   FPS + colliders; no console errors across three rounds. Add a `## P1 — weapons,
   economy, tacticals` section to `docs/PROGRESS.md`, filled in honestly per task.
**Done when:** `check` passes, `probe` is clean, and the P1 section of `PROGRESS.md` is
complete and accurate.

---

## Sequencing & verification
1. Implement one task at a time in P1-1 -> P1-7 order; `npm run check` after each.
2. `npm run probe` after P1-1, P1-5, and P1-7; paste the output into `docs/PROGRESS.md`.
3. A task is *verified* only when the probe is clean.
4. **First action on approval:** implement P1-1, then continue in order.

## Resolved decisions (for the record)
- Money + armor persist across round resets (P1-3 changes `PlayerState.reset()`).
- Frag does not self-damage the thrower; it damages bots.
- Bots ignore all P1 tacticals (no bot AI change this pass).
- Scope is RMB-held on the sniper; a non-sniper ignores RMB.
- Shotgun/sniper are semi-auto; the shotgun's `pellets:8` fan out in `main.js`'s shot
   handler, each perturbed by the live spread.
