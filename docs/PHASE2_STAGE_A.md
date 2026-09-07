# PHASE 2, STAGE A — Rendering foundation

You are working in the `cs-browser` repo. Read `CLAUDE.md` before you touch anything.

**This document is split into three RUNS. Do one run per session.** Do not start a run until
the previous run is committed, pushed, and verified.

Every hard constraint applies to every run, without exception:

- **No build step. No npm install. No bundler. No new dependencies of any kind.**
- Three.js r0.170 from the importmap in `index.html`. Do not change the pinned version.
  `three/addons/` **is** already mapped and may be imported — it is not a new dependency.
- **No external assets.** No textures, models, HDRIs, or audio files. Procedural canvas
  textures only.
- Vanilla ES modules. `const` by default, `let` when reassigned, never `var`.
- Keep every file under ~300 lines. Split when it grows past that.
- 1 world unit = 1 m. Y is up. Forward is -Z.
- **Never rewrite a working file from scratch. Make targeted edits only.**

After each task: run `npm run check`, then commit that task alone with the exact commit
message given under it.

---

## This supersedes RUN 3 of `docs/FIX_PROMPT_4.md`

`FIX_PROMPT_4.md` RUN 3 (Tasks 6–8) was written but never built. **Do not do it.** Its three
tasks are absorbed here in a corrected form. In particular its Task 8 told you to use
`tex.clone()` for per-surface texture repeat — that approach is **wrong** once geometry is
merged in Run A2, and is replaced by UV scaling. If you have `FIX_PROMPT_4.md` open, close
it; this document is the current instruction for graphics.

## Two traps in this stage that fail silently

1. **`colorSpace` belongs on color maps only.** Setting `SRGBColorSpace` on a roughness map
   silently corrupts the roughness values — no error, just wrong-looking materials. Color
   maps get it; roughness maps must not.
2. **`npm run probe` cannot see any of this.** It has no GPU timing and cannot judge an
   image. A green probe means "nothing threw," not "it looks right." Every task below names
   what a human must check by eye.

---

# RUN A1 — PBR materials and renderer output (Tasks 1–2)

Everything in Stage C (global illumination) depends on this. `MeshLambertMaterial` has no
`roughness`, no `metalness`, and does not respond to `scene.environment` at all — so until
this lands, no lighting work can have any effect.

## Task 1 — Procedural roughness maps and PBR materials

### (a) `src/map/textures.js`

The existing `makeTexture(kind)` builds a 128×128 colour canvas. Add a parallel
`makeRoughness(kind)` that builds a greyscale roughness canvas the same way, and set the
colour space on the colour texture only.

In `makeTexture`, immediately before `cache.set(kind, tex);`, add exactly:

```js
  tex.colorSpace = THREE.SRGBColorSpace; // colour map — must be sRGB
```

Then add this new export at the end of the file, with its own cache:

```js
const roughCache = new Map();

// A greyscale roughness map built from the same grain idea as the colour texture:
// darker = smoother, lighter = rougher. Deliberately NOT marked sRGB — roughness is
// data, not colour, and tagging it sRGB silently corrupts the values.
export function makeRoughness(kind) {
  if (roughCache.has(kind)) return roughCache.get(kind);

  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2600; i++) {
    const v = 140 + ((Math.random() * 70) | 0);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect((Math.random() * size) | 0, (Math.random() * size) | 0, 1, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.needsUpdate = true;
  roughCache.set(kind, tex);
  return tex;
}
```

### (b) `src/map/mapBuilder.js`

Import `makeRoughness` alongside `makeTexture`. Add this table near the top:

```js
// Per-surface roughness. Concrete is nearly matte; crates are slightly less so.
const ROUGHNESS = { concrete: 0.95, crate: 0.80, sand: 1.0, floor: 0.90 };
```

Replace the body of `getMaterial` (currently `MeshLambertMaterial` at `mapBuilder.js:58`):

```js
    mat = new THREE.MeshStandardMaterial({
      map: makeTexture(kind),
      roughnessMap: makeRoughness(kind),
      roughness: ROUGHNESS[kind] ?? 0.9,
      metalness: 0.0,
    });
```

Do the same for the floor material at `mapBuilder.js:18` — `MeshStandardMaterial` with
`map: floorTex`, `roughnessMap: makeRoughness('floor')`, `roughness: 0.9`, `metalness: 0.0`.

Leave the bombsite ring as `MeshBasicMaterial` — it is an unlit UI marker, not a surface.

### (c) The other three material sites

- `src/bots/bot.js:158` and `:164` — `MeshStandardMaterial({ color: <unchanged>, roughness:
  0.65, metalness: 0.0 })`. Keep the existing colours exactly.
- `src/weapons/viewmodel.js:37-43` — `MeshStandardMaterial({ color: 0x222228, roughness:
  0.40, metalness: 0.60 })`. Gunmetal. Leave the muzzle flash as `MeshBasicMaterial`; it is
  meant to be unlit.
- `src/game/projectile.js:28` — `MeshStandardMaterial({ color, roughness: 0.55, metalness:
  0.0 })`.

**Done when:** nothing throws, the scene still renders, and every surface except the bombsite
ring and the muzzle flash uses `MeshStandardMaterial`. It will look **darker and flatter than
before** at this point — that is expected and Task 2 fixes it. Do not compensate by changing
colours.

Commit: `feat: PBR materials with procedural roughness maps`

## Task 2 — Renderer output, tone mapping, and light retune

### (a) `src/core/engine.js`, in the constructor after the renderer is created

Add exactly:

```js
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
```

### (b) Retune the two lights — this is required, not optional

Three r170 lights are physically based, and ACES tone mapping darkens the image. The current
values were tuned for Lambert with no tone mapping and will look badly wrong now. Change the
two existing light constructions to exactly:

```js
    this.hemisphere = new THREE.HemisphereLight(0xbcd3f0, 0x4a4036, 0.45);
```
```js
    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.2);
```

Keep `sun.position.set(60, 90, 40)` unchanged. The warmer sun against the cooler sky fill is
what will make bounce light read as bounce light in Stage C.

**Done when:** the map has real tonal range — bright sunlit faces, genuinely darker shaded
faces — instead of the flat mid-grey it has today, and nothing is blown out to pure white.

If it is clearly too dark or too bright overall, change **only** `toneMappingExposure`, and
only within the range 0.8–1.3. Do not change the light intensities, the colours, or the
material roughness values to compensate.

Commit: `feat: sRGB output, ACES tone mapping, retuned lights`

## End of RUN A1 — verify and push

```bash
npm run check          # must stay 28/28
npm run probe          # must stay exception-free; it CANNOT judge the image
git fetch origin
git push origin main
git rev-list --count origin/main..main     # must print 0
```

A plain fast-forward push works. Do **not** use `--force`. If the push is rejected, stop and
report it rather than forcing.

In `docs/PROGRESS.md`, record that this stage was verified by `npm run check` and `npm run
probe` only, and that the visual result needs a human to confirm by eye.

---

# RUN A2 — draw calls and shadows (Tasks 3–4)

Do not start until RUN A1 is pushed. This run buys the frame budget that volumetrics will
later spend, and it must happen **before** shadows so `castShadow` is set on the final
meshes rather than on 28 meshes that are about to be thrown away.

## Task 3 — Merge static geometry, with correct texel density

`src/map/mapBuilder.js` currently allocates **one `BoxGeometry` and one `Mesh` per box** — 28
of each, every identical 1×1×1 crate getting its own geometry. It also applies a single
shared `repeat.set(4, 4)` to every surface, so a 61 m wall and a 1 m crate both get 4 tiles
across their faces and the walls are badly stretched.

Both problems are solved by the same change: **bake texel density into the UVs, then merge**.

Import at the top of `mapBuilder.js`:

```js
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
```

Then in `buildMap`, replace the per-box mesh loop with this shape:

1. Group boxes by `tex` kind.
2. For each box, build its `BoxGeometry(w, h, d)`, then **scale its UV attribute so one
   texture tile covers 2 metres**. A `BoxGeometry`'s UVs run 0→1 per face, so multiply the
   `uv` attribute per face by that face's size in metres divided by 2. Walk the `uv` array
   and scale each pair. Then `geometry.translate(x, y, z)` to place it in world space.
3. `mergeGeometries(list)` per kind → **one `Mesh` per texture kind** (3 meshes), each using
   the shared material from `getMaterial`.
4. Set the material's texture `repeat.set(1, 1)` — the UVs now carry the tiling, so a
   material-level repeat would double-apply it.
5. Build the collider list exactly as before, **from `mapData.boxes`**, unchanged. Colliders
   must not be affected by any of this.

Also fix the latent bug at `mapBuilder.js:15`: `floorTex.repeat.set(30, 30)` mutates the
**shared cached texture object** returned by `makeTexture('floor')`. It happens to be safe
today only because nothing else uses the `floor` kind. Scale the floor's UVs the same way as
the boxes instead, and leave the cached texture's repeat alone.

**Done when:** `renderer.info.render.calls` drops from roughly 45 to **under 12**, tiling
looks the same scale on a 61 m wall as on a 1 m crate, and the map is visually identical in
layout — every box in the same place, and collision unchanged (walk into a wall and a crate
to confirm).

Commit: `perf: merge static geometry per material with UV-baked texel density`

## Task 4 — Sun shadows

`src/core/engine.js`. `castShadow` currently appears **nowhere in the entire repo**, so every
box floats with no ground contact.

Add exactly, after the sun is created:

```js
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // A tight ortho frustum fitted to the real world extents (x/z are -30.5..30.5).
    // The default frustum would spend the whole shadow map on empty space.
    const s = this.sun.shadow.camera;
    s.left = -35; s.right = 35; s.top = 35; s.bottom = -35;
    s.near = 1; s.far = 220;
    s.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
```

Then set `castShadow = true` and `receiveShadow = true` on the merged map meshes in
`mapBuilder.js`, and on the bot meshes in `src/bots/bot.js:155-174`. The floor mesh gets
`receiveShadow = true` only — it casts nothing.

If shadow acne (dark stripes on lit surfaces) appears, adjust **only** `bias` and
`normalBias`. **Do not raise `mapSize` above 2048** — it costs frame rate for no visible gain
at this world size.

**Done when:** boxes and bots drop grounded shadows, there is no acne and no peter-panning
(shadow visibly detached from the object casting it), and the frame rate is still smooth.

Commit: `feat: sun shadow mapping with a fitted ortho frustum`

## Task 5 — Render resolution: the most consequential line in this stage

`src/core/engine.js:10` currently reads:

```js
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

On a Retina display that is **not** rendering 1920×1080. A 1512×982 window renders at
3024×1964 = **5.9 megapixels**; a true 1080p window renders at **8.3 megapixels**. Every
screen-space effect planned for this project — ambient occlusion, volumetric light shafts,
bloom — scales directly with that number. At 4× the pixels the full stack costs roughly
34 ms per frame, which is 29fps, and **no amount of tuning fixes having four times the
pixels**.

Render at 1× and let anti-aliasing come from SMAA later in the pipeline. Replace that line
with exactly:

```js
    // Render at 1 device pixel per CSS pixel. On a Retina display the default
    // min(dpr, 2) means ~4x the pixels, and every screen-space effect later in this
    // project (AO, volumetrics, bloom) scales directly with that. Anti-aliasing comes
    // from SMAA in the post stack instead. `?rs=2` forces the old behaviour for
    // side-by-side comparison.
    const rsParam = Number(new URLSearchParams(location.search).get('rs'));
    const renderScale = Number.isFinite(rsParam) && rsParam > 0
      ? Math.min(rsParam, 2)
      : 1;
    this.renderer.setPixelRatio(renderScale);
```

Note that `_onResize` at `engine.js:41-45` calls `setSize` but never re-applies
`setPixelRatio` — that is existing behaviour and is correct, since the pixel ratio persists.
Do not add a `setPixelRatio` call there.

**Done when:** the game renders at 1× by default and `?rs=2` visibly restores the sharper,
slower rendering. Edges will look slightly softer at 1× until SMAA lands in a later stage —
that is expected, and is the trade that makes 60fps reachable at all.

Commit: `perf: render at 1x device pixel ratio with a ?rs= override`

## End of RUN A2 — verify and push (same commands as RUN A1).

---

# RUN A3 — ray infrastructure and allocation sweep (Tasks 6–10)

Do not start until RUN A2 is pushed. This run is **pure CPU work with zero visual change**.
It is the enabling change for the Stage C GI bake (which fires ~2 million rays through
`rayAABB`) and for every decal, spark, and grenade bounce in Stage E.

## You may use up to 3 subagents in parallel for this run

The five tasks touch five different files. Three of them are fully independent and can run
concurrently. **Read this whole section before dispatching anything.**

**Wave 1 — dispatch up to 3 subagents in parallel, one file each. No overlap:**

| Agent | Owns this file, and only this file | Task |
|---|---|---|
| A | `src/core/physics.js` | Task 6 |
| B | `src/bots/bot.js` | Task 7 |
| C | `src/game/effects.js` | Task 8 |

**Wave 2 — after all three return, do these yourself, in order:**

- Task 9 — `src/player/playerController.js` (**must wait for Agent A**: it imports the `STEP`
  constant that Task 6 newly exports)
- Task 10 — `src/weapons/hitscan.js`

**Three rules that will break this run if ignored:**

1. **No agent runs any `git` command. Ever.** Three agents committing at once collide on
   `.git/index.lock` and you will get a corrupted or half-staged commit. Agents edit files
   and report back; **you** stage, commit, and push, one commit per task, from the main
   session only.
2. **No two agents touch the same file.** The table above is the complete ownership map. An
   agent that thinks it needs to edit a file it does not own must stop and report that
   instead of editing it.
3. **No agent runs `npm run check` or `npm run probe`.** You run those once, yourself, after
   all of Wave 1 has returned. Concurrent probe runs fight over port 8080 and the Chrome
   debugging port and will fail spuriously.

If subagents are unavailable, just do Tasks 6→10 in that order yourself. The order is what
matters; the parallelism is only a speed-up.

## Task 6 — Rewrite `rayAABB`: no allocation, and return the hit normal

`src/core/physics.js:86`. Two problems:

1. It allocates the array literal `['x','y','z']` on **every call**, and iterates with string
   property lookups. With 4 bots × 27 colliders of line-of-sight rays every frame, plus 8
   shotgun pellets × ~35 rays per blast, this is the hottest allocation in the game.
2. It returns `tmin` only. It does not record **which slab** produced the hit, so **no
   surface normal is recoverable anywhere in the codebase.** Decals, sparks, and bouncing
   grenades all need one.

Rewrite it with the x/y/z slabs unrolled — no array, no string lookups — tracking which axis
won and the sign of the entry. Keep the existing parallel-axis guard at `|d| < 1e-8` and the
existing `maxT` semantics.

**Keep the return contract backward compatible.** Every current caller uses the return value
as a number or checks it against `null`:

- `src/weapons/hitscan.js:17` and `:37`
- `src/bots/bot.js` `_lineOfSight`
- `src/game/effects.js` `_playerSees`
- `src/game/projectile.js` wall sweep

So: **return the same `number | null` as today**, and write the axis and sign into an
optional caller-supplied scratch object passed as a sixth argument:

```js
// rayAABB(origin, dir, min, max, maxT = Infinity, outHit = null) -> number | null
// Returns the entry distance as before. When `outHit` is supplied it is filled with
// { axis: 0|1|2, sign: -1|1 } describing the face that was crossed, so the caller can
// build a surface normal without a second test. Pass a module-level scratch object;
// do not allocate one per call.
```

Every existing call site keeps working untouched because they simply omit the sixth
argument. Do **not** change any caller in this task — Stage E wires the normals through.

**Done when:** `npm run check` passes, `npm run probe` is exception-free with every existing
behaviour assertion still green (shooting still stops at walls, bot line-of-sight still
blocks behind crates, grenades still detonate on contact), and `rayAABB` allocates nothing.

Commit: `perf: allocation-free rayAABB that reports the hit face`

### Also in this file, while you are here

- **Delete `groundCheck`** (`physics.js:70`). It has **zero call sites** — grep the whole of
  `src/` to confirm before deleting. `resolveCapsuleVsBoxes` already returns `grounded`.
- **Delete the dead `opts.vy` destructure** at `physics.js:32`. It is destructured and never
  used. Leave the `opts = {}` parameter itself alone — two call sites still pass it.
- **Export `STEP`**: change `const STEP = 0.6;` to `export const STEP = 0.6;`. Task 9 imports
  it. Do not change its value.

## Task 7 — Stop allocating 12 geometries and 12 materials for 3 shapes (Agent B)

`src/bots/bot.js:155-177`. Each of the 4 bots builds its own body, head, and nose geometry
**and its own materials** — 12 geometries and 12 materials for 3 distinct shapes and 3
distinct colours.

Hoist to module scope, above the class:

- Three shared geometries: body `BoxGeometry(0.8, 1.8, 0.8)`, head `BoxGeometry(0.4, 0.4,
  0.4)`, nose `BoxGeometry(0.12, 0.12, 0.25)`.
- Shared materials keyed by team colour, built lazily in a `Map` the same way
  `mapBuilder.getMaterial` does it, plus one shared nose material for `0x222228`.

Keep every existing value identical: the same sizes, the same positions
(`body.y = 0.9`, `head.y = 2.0`, `nose` at `(0, 1.3, -0.5)`), the same colours, the same
`roughness: 0.65, metalness: 0.0`, and the `castShadow`/`receiveShadow` flags added in RUN
A2. **This is a pure allocation change with no behavioural difference.**

Do **not** dispose these geometries or materials anywhere — they are shared and live for the
page's lifetime. If `bot.js` has any `.dispose()` call on them, remove it.

**Done when:** bots look and behave exactly as before, and the module allocates 3 geometries
total regardless of bot count.

Commit: `perf: share bot geometries and materials across all bots`

## Task 8 — Pool the explosion mesh (Agent C)

`src/game/effects.js:107-118`. `_spawnExplosion` allocates a **fresh `SphereGeometry(1, 16,
12)` and a fresh `MeshBasicMaterial`** on every detonation, then disposes both when the
explosion finishes. That is a full geometry upload and teardown per grenade.

Build **one** geometry and **one** material at module scope, and give the effect a small
pool of meshes (4 is plenty — at most one frag and one flash can be airborne at a time).
Reuse a pooled mesh by resetting its `scale`, `material.opacity`, and `position`, setting
`visible = true` on spawn and `visible = false` when its life expires, instead of
`scene.add`/`scene.remove` + `dispose()`.

**Careful:** the material's `opacity` is animated per explosion. If all pooled meshes share
one material instance, two simultaneous explosions will fight over the same opacity value.
Either give each pooled mesh its own material (4 materials, built once) or accept the shared
fade — **pick the 4-material version**, it is the same cost and has no edge case.

Keep the existing timings and constants exactly: `EXPLOSION_T 0.3`, scale from 0.3 to
`FRAG_RADIUS`, opacity 1→0, `AdditiveBlending`, `depthWrite: false`.

**Done when:** explosions look identical, and no geometry or material is constructed or
disposed after startup.

Commit: `perf: pool the explosion mesh instead of allocating per detonation`

## Task 9 — Scratch vectors in the headroom check (you, after Agent A)

`src/player/playerController.js:165-168`. The un-crouch headroom test allocates **two fresh
`THREE.Vector3`s every frame the player is standing** — roughly 120 per second, which in
wall-clock terms is worse than the `rayAABB` array literal during normal play.

Hoist them to module-scope scratch objects and mutate in place, matching the pattern already
used at `src/main.js:74-76` and `src/core/physics.js:16`. A single module-level
`{ min: Vector3, max: Vector3 }` reused each frame is the right shape.

Then replace the hardcoded `0.6` at `playerController.js:170` with the `STEP` constant
imported from `../core/physics.js` (Task 6 exports it). Behaviour must not change — `STEP`
is 0.6.

**Done when:** the headroom check allocates nothing per frame and crouch behaviour under a
low overhang is unchanged.

Commit: `perf: scratch vectors and shared STEP in the headroom check`

## Task 10 — Scratch result object in hitscan (you)

`src/weapons/hitscan.js:17` and `:37`. `resolveShot` allocates a fresh result object literal
for **every collider that improves on the current nearest** — up to ~10 per ray, times 8
pellets on a shotgun blast.

Use a single module-level scratch result object, mutated in place as the nearest hit
improves, and return it. Document in a comment that the returned object is **reused between
calls**, so a caller must copy anything it wants to retain.

This is safe today because `main.js:90` discards the return value entirely and no other
caller stores it. **Do not change any caller in this task.**

**Done when:** `npm run probe` shows every P1-1..P1-7 behaviour block still green —
especially the shotgun pellet counts and the wall-blocks-bot cases, which are exactly what a
mistake here would break.

Commit: `perf: reuse a scratch result object in resolveShot`

## End of RUN A3 — verify and push

Run these **once, yourself, after all five tasks are committed**:

```bash
npm run check          # must stay 28/28
npm run probe          # must stay exception-free, every P1 block green
git fetch origin
git push origin main
git rev-list --count origin/main..main     # must print 0
```

This run changes no visuals at all. If anything looks different, something is wrong —
say so rather than adjusting it to taste.

---

## Verification, every run

```bash
npm run check     # syntax only — necessary, never sufficient
npm run probe     # exception check only; it cannot see an image or measure a frame
```

For everything the probe cannot reach — tone mapping, shadows, texel density, frame rate —
reason about the code and state plainly in `docs/PROGRESS.md` what you verified versus what
needs a human. Never claim a visual change is correct because `npm run check` passed.

If a task fails twice, write what you tried under it in `docs/PROGRESS.md`, mark it `[!]`,
and stop — do not improvise a different approach.
