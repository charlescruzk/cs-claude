# P0 Progress

Mark each task `[x]` when its acceptance criteria are met, `[!]` if blocked after two
attempts (write what you tried). Add a one-line note per task.

- [x] P0-1 Engine core and frame loop — Engine (renderer/scene/cam/clock/resize + `requestAnimationFrame` loop, dt clamped to 0.1s, hemisphere+directional light, 50×50 ground + test cube, `clearTestWorld()` for P0-3); EventBus with shared `events`; main.js wires engine + `window.__game`.
- [x] P0-2 Input and pointer lock — `Input` (keys Set, mouseDX/DY accumulated per frame, 3-button `mouseDown`, `justPressed` edge detection, pointer lock on overlay click, `locked` flag, begin/endFrame resets). `#lock-overlay` was already scaffolded in index.html; wired its show/hide to the lock state in main.js.
- [x] P0-3 Map data and blockout builder — `mapData` (26 boxes: perimeter, 30 m central lane, wing dividers, mid crates, two 2-step 1 m ledges, a 1 m jump box, T/CT cover, bombsite-A platform; 6 T + 6 CT spawns on opposite ends); `textures.makeTexture(kind)` procedural canvas (noise + seams, RepeatWrapping, cached per kind); `buildMap` adds floor + one mesh/collider per box + bombsite rings, returns `{colliders, spawns, sites}` with `colliders.length === boxes.length`. main.js clears the test cube and parks a static camera on a T spawn.
- [ ] P0-4 Player controller with collision —
- [ ] P0-5 Weapons: data, firing, hitscan, viewmodel —
- [ ] P0-6 Bots —
- [ ] P0-7 HUD —
- [ ] P0-8 Round loop, teams, scoreboard —
- [ ] P0-9 Polish and stability pass —

## Decisions made along the way

- P0-2: `#lock-overlay` (and its CSS) was already present in the scaffold's index.html, so P0-2 only wired its show/hide to the pointer-lock state rather than adding the div. No index.html edit was needed.
- P0-2: `justPressed` is edge-triggered via a `_downCodes` set; mouse "just down" is handled by the weapon's own `prevTrigger` flag (P0-5), so `Input` only tracks per-key edges.

## Known issues

(Be honest. Anything that does not meet the spec goes here.)
