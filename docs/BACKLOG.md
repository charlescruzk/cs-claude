# Backlog

Work that was specified but never built. Everything here was rescued from prompt documents
that have since been deleted — see `docs/PROGRESS.md` for the history of what *was* built.

Each entry says what it is, why it was left, and what it touches. Nothing here is urgent;
this exists so the ideas are not lost with the scaffolding that carried them.

---

## Gameplay

### Buy menu keyboard shortcuts
`src/hud/buyMenu.js` is mouse-only. A full buy should be completable on the keyboard:

- `Digit1` / `Digit2` / `Digit3` buy the matching item while the panel is open
- `Escape` closes the panel, in addition to `B`
- An **owned** state visually distinct from the existing `.poor` (unaffordable) state — owned
  Kevlar currently looks identical to Kevlar you cannot afford

Route every key through the existing `input.justPressed(...)` edge detection. Do **not** add a
second `keydown` listener; `src/core/input.js` already owns keyboard state and a second
listener double-fires.

*Origin: FIX_PROMPT_4 RUN 4 Task 9.*

### Key rebinding
Key codes are hardcoded across five files: `KeyW`/`KeyA`/`KeyS`/`KeyD` in
`playerController.js`, `Digit1`–`Digit4` and `KeyR` in `weapon.js`, `KeyG`/`KeyH` in
`tactical.js`, `KeyB` in `buyMenu.js`, `Tab` in `scoreboard.js`. Nothing can be rebound.

The design: a `src/core/bindings.js` holding an action → `KeyboardEvent.code` map, plus
`isDown(action)` and `justPressedAction(action)` added to `input.js` as a **strictly additive**
change so the existing `justPressed(code)` API keeps working and the probe stays green. Then
migrate call sites one file per commit. Use `code`, never `key` — `code` is layout-independent,
so WASD still works on AZERTY.

Two traps: the captured `keydown` during a rebind must not also fire its normal game action
that frame, and binding a code already used by another action must be rejected rather than
silently accepted.

The settings panel (`src/hud/settingsMenu.js`) already exists and is where the rebinding UI
would live — it currently has sensitivity, weapon bob, volume and invert-Y.

*Origin: FEATURE_PROMPT_5 RUN 6 Tasks 15–17.*

---

## Rendering — Phase 2, Stages C–E

Stages A and B shipped: PBR materials, ACES tone mapping, sun shadows, merged geometry, 1×
render scale, allocation-free `rayAABB`, chamfered geometry, the multi-level map, humanoid
bots and procedural weapons.

Stages C, D and E were planned in detail and never started. The full plan — including the
rejected approaches and why they were rejected — is outside this repo at
`~/.claude/plans/i-want-to-get-fluttering-plum.md`. Summary:

- **Stage C — global illumination.** A CPU-raytraced irradiance volume in a `Data3DTexture`
  (40×5×40 probes, ~192 KB, three bounces, ~1.4 s baked during the click-to-play screen),
  sampled by world-space fragment position so every uniform is scene-constant. Two approaches
  were evaluated and rejected with numbers: cubemap-per-probe needs ~48,000 render passes at
  useful density, and per-object SH uniforms via `onBeforeCompile` silently do not work with
  shared materials.
- **Stage D — volumetrics and post-processing.** `EffectComposer` with GTAO, raymarched light
  shafts sampling the sun's shadow map at half res, bloom, SMAA. Critical ordering detail:
  `OutputPass` comes **before** `SMAAPass`, not after. Density must ramp **up** with height so
  the 0–1.9 m combat band stays clear air.
- **Stage E — physics.** Fixed-timestep accumulator, then dynamic props via 8-corner verlet
  shape matching, impact decals as a pooled `InstancedMesh` ring buffer, and weapon recoil
  patterns. Ragdolls from this stage were built early and shipped.

---

## Known limitations, not yet addressed

- **Multiplayer is trust-based.** The relay validates nothing; the shooter's client decides a
  hit landed. Documented honestly in `docs/MULTIPLAYER.md`. Real anti-cheat needs an
  authoritative server with lag-compensated hit registration, which cannot run on GitHub Pages.
- **Browser-side multiplayer is unverified.** Headless Chrome in the dev sandbox refuses
  `ws://localhost` even against a textbook-minimal server, so the relay is proven correct only
  against a hand-written RFC 6455 client (`npm run relay:test`, 13/13).
- **The probe cannot see anything visual.** It stubs `requestPointerLock`, so no real
  `mousemove` has ever fired in an automated test. Lighting, geometry, feel and frame rate all
  need a human.
