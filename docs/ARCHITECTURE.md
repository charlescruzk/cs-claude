# Architecture

Vanilla ES modules, Three.js from an importmap, no build step. `index.html` loads
`src/main.js`, which wires everything together and runs the frame loop.

## Folder layout

```
index.html                 entry page, importmap, canvas, HUD root <div>
src/
  main.js                  creates Engine, Game; starts the loop; window.__game
  core/
    engine.js              renderer, scene, camera, clock, resize, frame loop
    input.js               keyboard/mouse state, pointer lock, per-frame consumption
    physics.js             AABB helpers, swept-capsule-vs-box collision, gravity
    events.js              tiny EventBus (on/off/emit) for cross-module messages
  map/
    mapData.js             the blockout map as plain data: boxes, spawns, sites
    mapBuilder.js          turns mapData into meshes + a colliders array
    textures.js            procedural canvas textures (sand, concrete, crate)
  player/
    playerController.js    movement, look, jump, crouch, collision via physics.js
    playerState.js         health, armor, money, team, alive flag
  weapons/
    weaponData.js          per-weapon stats (damage, rpm, mag, reserve, spread, recoil)
    weapon.js              Weapon class: fire/reload/timers, emits 'shot'
    hitscan.js             raycast against colliders + bot hitboxes, returns hit info
    viewmodel.js           first-person primitive gun mesh + recoil kick + muzzle flash
  bots/
    botData.js             waypoint list, bot names, count
    bot.js                 Bot class: mesh, health, state machine (patrol/engage/dead)
    botManager.js          spawns, updates, respawns bots; exposes hittable list
  hud/
    hud.js                 DOM-based HUD: crosshair, health, armor, ammo, timer, killfeed
    scoreboard.js          Tab overlay with team scores and K/D
  game/
    round.js               round state machine: freeze -> live -> end -> reset
    teams.js               team constants, spawn assignment, win conditions
scripts/
  check.mjs                syntax check
docs/                      specs and progress
```

## Data flow per frame

```
Engine.loop(dt)
  Input.beginFrame()
  Round.update(dt)               // timers, win check, may reset entities
  Player.update(dt, input, colliders)
  Weapon.update(dt, input)       // may emit 'shot' -> Hitscan -> Bot.takeDamage
  BotManager.update(dt, player)  // bots may emit 'botShot' -> Player.takeDamage
  Viewmodel.update(dt)
  HUD.update(state)
  Input.endFrame()
  Renderer.render(scene, camera)
```

Cross-module communication goes through `core/events.js`:

| Event | Payload | Emitter | Listeners |
|-------|---------|---------|-----------|
| `shot` | `{ origin, dir, weapon }` | weapon.js | hitscan (in main.js) |
| `hit` | `{ target, damage, headshot }` | hitscan.js | bot / player, hud |
| `kill` | `{ killer, victim, weapon }` | bot.js / playerState.js | hud, round |
| `roundState` | `{ state, timeLeft }` | round.js | hud, botManager, player |
| `roundEnd` | `{ winner }` | round.js | hud, scoreboard |

## Conventions

- 1 unit = 1 meter. Y up. Forward is -Z.
- Player: capsule radius 0.4, standing height 1.8 (eye 1.6), crouch height 1.2 (eye 1.0).
- Speeds are tuned to feel like 1.6: run 6.5 m/s, crouch 2.5 m/s, jump velocity 4.8 m/s,
  gravity 20 m/s². Tweak in `playerController.js` constants only.
- Colliders are axis-aligned boxes `{ min: Vector3, max: Vector3 }` produced by
  `mapBuilder.js`. Everything static collides through this list. No physics library.
- Bots are 0.8 × 1.8 × 0.8 boxes with a separate 0.4 head box on top for headshots.
- All timers and RPM are in seconds. `dt` is passed explicitly; never read the clock
  from inside a system.
- HUD is DOM (`<div id="hud">`), styled from a `<style>` block in `index.html`.
  No canvas 2D overlay in P0.
