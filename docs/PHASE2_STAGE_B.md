# PHASE 2, STAGE B — Procedural geometry

You are working in the `cs-browser` repo. Read `CLAUDE.md` before you touch anything.

**Two RUNS. One run per session.** Do not start a run until the previous one is committed,
pushed, and verified.

## Read this first — what "primitive geometry" actually means

`CLAUDE.md` forbids external **assets**: no downloaded models, textures, HDRIs, or audio.
It does **not** mean axis-aligned boxes. That restriction came from the P0 blockout spec,
where boxes were correct because the goal was working gameplay, and it was never revisited.

Three.js generates rich geometry procedurally with nothing but core classes:
`ExtrudeGeometry` (with bevel), `LatheGeometry`, `CylinderGeometry`, `CapsuleGeometry`,
`TorusGeometry`, `TubeGeometry`, `ShapeGeometry`. All core, no addons, no files, no
dependencies. **This entire stage adds zero bytes of asset.**

Every other constraint still applies without exception:

- **No build step. No npm install. No bundler. No new dependencies.**
- Three.js r0.170 from the importmap. `three/addons/` is already mapped and is not a new
  dependency.
- Vanilla ES modules. `const` by default, `let` when reassigned, never `var`.
- Every file under ~300 lines. One concern per file.
- 1 unit = 1 m. Y is up. Forward is -Z.
- **Never rewrite a working file from scratch. Targeted edits only.**

## The one rule that must not be broken in this stage

**This stage changes how things LOOK, never how they BEHAVE.** Specifically:

- `bot.box` and `bot.headBox` (the hit AABBs written by `_syncMesh`) must keep **exactly**
  their current dimensions and offsets. Body 0.8 × 1.8 × 0.8 from y=0; head 0.4 × 0.4 × 0.4
  from y=1.8. Change these and every hitscan behaviour assertion in `npm run probe` changes
  with them, and the game's feel changes silently.
- `map.colliders` stays byte-identical — same count, same order, same values. Colliders come
  from `mapData.boxes`, never from geometry.
- Player capsule radius, height, step height, and speeds are untouched.

Visual meshes get richer. Collision does not move. If a change would alter either, stop and
report it instead of making it.

After each task: `npm run check`, then commit that task alone with the exact message given.

---

# RUN B1 — The geometry library and chamfered architecture (Tasks 1–2)

## Task 1 — `src/geo/shapes.js` (new file)

Two exported helpers. This file is the foundation for everything in Stage B and should stay
well under 150 lines.

### `beveledBox(w, h, d, chamfer = 0.04)`

A box with all twelve edges chamfered. Real cast concrete is chamfered at every edge, and a
chamfer catches a specular highlight along the edge — under the PBR materials and shadows
from Stage A, this is the single biggest change in how the world reads.

Build it with `ExtrudeGeometry` over a rounded-rectangle `Shape`:

```js
import * as THREE from 'three';

// A box with all 12 edges chamfered. The rounded-rect Shape chamfers the four
// vertical edges; bevelEnabled chamfers the top and bottom rims. curveSegments: 1
// and bevelSegments: 1 keep them flat chamfers rather than rounded fillets, which
// is what reads as cast concrete rather than moulded plastic.
export function beveledBox(w, h, d, chamfer = 0.04) {
  const c = Math.min(chamfer, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const x = w / 2 - c;
  const z = d / 2 - c;
  shape.moveTo(-x, -z - c);
  shape.lineTo(x, -z - c);
  shape.lineTo(x + c, -z);
  shape.lineTo(x + c, z);
  shape.lineTo(x, z + c);
  shape.lineTo(-x, z + c);
  shape.lineTo(-x - c, z);
  shape.lineTo(-x - c, -z);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h - 2 * c,
    bevelEnabled: true,
    bevelThickness: c,
    bevelSize: c,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });

  // Extrude runs along +Z; rotate so it runs along +Y, then centre on the origin.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, h / 2, 0);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}
```

Verify the result is centred on the origin and measures exactly `w × h × d` by checking
`geo.boundingBox` after `computeBoundingBox()`. If it does not, fix the translate — do not
adjust callers to compensate.

### `boxProjectUvs(geo, metresPerTile = 2)`

`mapBuilder.scaleBoxUvs` assumes `BoxGeometry`'s exact 6-face / 4-vertex UV layout. A
beveled box does not have that layout, so that function cannot be reused and **must not be
adapted** — it will silently produce garbage.

Replace it with world-axis projection, which works on any geometry: for each vertex, pick
the dominant axis of its normal and project the other two coordinates as UV, scaled by
`1 / metresPerTile`. About 25 lines. This automatically gives consistent texel density on
every surface regardless of size or shape, and it is what the chamfer strips need in order
not to smear.

Call it **after** any rotate/translate/center, so it projects final local coordinates.

**Done when:** `beveledBox(1, 1, 1)` produces a unit cube with visible chamfers, centred at
the origin, and `boxProjectUvs` gives it seamless tiling.

Commit: `feat: procedural beveled box and world-axis UV projection`

## Task 2 — Chamfer the map

`src/map/mapBuilder.js`. Replace `new THREE.BoxGeometry(w, h, d)` with
`beveledBox(w, h, d, 0.04)`, and replace the `scaleBoxUvs(geo, w, h, d)` call with
`boxProjectUvs(geo, 2)`. Then **delete `scaleBoxUvs`** — it has no other caller.

The floor keeps `PlaneGeometry`, but switch its `scaleUvs(floorGeo, 7.75, 7.75)` to
`boxProjectUvs(floorGeo, 2)` as well, and set the floor material's `map.repeat` and
`roughnessMap.repeat` to `1, 1` to match the boxes. That removes the last of the two
competing tiling conventions in this file — after this change **every surface in the game
uses one rule: one tile per 2 metres, carried in the UVs, material repeat 1×1.**

Use a chamfer of **0.04 m** for walls and large masses and **0.02 m** for the 1 m crates —
a 4 cm chamfer on a 1 m crate is proportionally too heavy. Pick per box from its smallest
dimension: `size < 1.5 ? 0.02 : 0.04`.

**Colliders must not change.** They are built from `mapData.boxes` in their own loop and must
stay exactly as they are. The chamfer is visual only — the player still collides with the
full un-chamfered box, which is correct and is what you want.

**Done when:** every edge in the map catches a highlight, draw calls are unchanged (still one
merged mesh per texture kind), tiling is seamless across chamfers, and `npm run probe` shows
every behaviour block still green.

Commit: `feat: chamfered map geometry with projected UVs`

## End of RUN B1 — verify and push

```bash
npm run check          # must stay 28/28
npm run probe          # must stay exception-free, every P1 block green
git fetch origin
git push origin main
git rev-list --count origin/main..main     # must print 0
```

---

# RUN B2 — Characters and weapons (Tasks 3–4)

Do not start until RUN B1 is pushed. Both tasks import from `src/geo/shapes.js`.

## You may use 2 subagents in parallel for this run

The two tasks touch entirely separate files and can run concurrently:

| Agent | Owns these files, and only these | Task |
|---|---|---|
| A | `src/geo/humanoid.js` (new), `src/bots/bot.js` | Task 3 |
| B | `src/geo/gun.js` (new), `src/weapons/viewmodel.js` | Task 4 |

**Same three rules as Stage A RUN A3:** no subagent runs any `git` command (three-way
`.git/index.lock` collisions corrupt the index — **you** do all staging, committing and
pushing from the main session); no two agents touch the same file; no subagent runs
`npm run check` or `npm run probe` (concurrent probes fight over port 8080 and the Chrome
debug port). Run those once yourself after both agents return.

If subagents are unavailable, do Task 3 then Task 4 yourself.

## Task 3 — Angular tactical humanoid (Agent A)

`src/bots/bot.js` currently builds each bot from three boxes: body 0.8×1.8×0.8, head
0.4³, and a nose wedge. Replace the *visual* with a jointed, faceted humanoid.

**This is on the critical path for Stage E**, which replaces the one-frame death flip with a
verlet ragdoll. A three-box bot has nothing to articulate. Build the part list so the ragdoll
can drive it directly.

Create `src/geo/humanoid.js` exporting `buildHumanoid(teamColor)` returning
`{ root, parts }` where `parts` is an object with **named, individually-transformable
`THREE.Mesh` entries**:

`head, torso, pelvis, upperArmL, upperArmR, lowerArmL, lowerArmR, thighL, thighR, shinL, shinR`

Proportions, for a 1.8 m figure (all built from `beveledBox` with a 0.015 chamfer, except
where noted):

| Part | Size (w × h × d) | Centre y | Notes |
|---|---|---|---|
| head | 0.24 × 0.26 × 0.26 | 1.66 | helmet; add a thin visor slab in near-black across the front |
| torso | 0.48 × 0.58 × 0.28 | 1.24 | plate carrier; team colour |
| pelvis | 0.36 × 0.20 × 0.26 | 0.88 | |
| upperArm L/R | 0.13 × 0.32 × 0.15 | 1.36, x ±0.30 | |
| lowerArm L/R | 0.11 × 0.30 × 0.13 | 1.04, x ±0.30 | |
| thigh L/R | 0.18 × 0.42 × 0.20 | 0.60 , x ±0.11 | |
| shin L/R | 0.15 × 0.40 × 0.17 | 0.20 , x ±0.11 | |

Add faceted shoulder pauldrons as small beveled boxes at the top outer corner of each upper
arm, in team colour — they widen the silhouette, which is what makes a figure readable at
40 m.

**Materials:** reuse the shared per-team material `Map` from the RUN A3 hoisting. Add exactly
two more shared materials: a near-black `0x1a1a1e` for the visor and limb segments, and a
mid-grey `0x55555c` for the pelvis. Do not allocate per bot — the shared-material pattern
from RUN A3 must survive this change.

**Wire into `bot.js`:** `_build` calls `buildHumanoid(teamColor)` and adds `root` to the
scene. `_syncMesh` keeps setting `root.position` and `root.rotation.y` exactly as it does
now.

**The hit boxes do not change.** `this.box` stays 0.8 × 1.8 × 0.8 from y=0 and
`this.headBox` stays 0.4³ from y=1.8, written in place by `_syncMesh` exactly as today. The
humanoid is narrower than 0.8 m, which means the hitbox is slightly generous — that is
deliberate and matches how 1.6 played. **Do not tighten it.**

Keep `castShadow` and `receiveShadow` on every part. Keep the death rotation at `bot.js`
`_die` as-is for now; Stage E replaces it.

**Done when:** bots read as armoured figures with a clear silhouette, team colour is visible
on torso and pauldrons at distance, every `npm run probe` behaviour block is still green
(especially the headshot and body-shot cases), and the module still allocates one geometry
set and one material set regardless of bot count.

Commit: `feat: angular tactical humanoid bots`

## Task 4 — Procedural weapon models (Agent B)

`src/weapons/viewmodel.js` builds the gun from two boxes and a sphere. It is on screen 100%
of the time and is the highest perceived-quality-per-triangle object in the game.

Create `src/geo/gun.js` exporting `buildGun(kind)` for the four kinds already in
`weaponData.js` (`pistol`, `rifle`, `shotgun`, `sniper`), returning a `THREE.Group`
assembled from:

- **Receiver** — `beveledBox`, the main body.
- **Barrel** — `CylinderGeometry` rotated to point along -Z. Use `LatheGeometry` for the
  sniper's stepped/threaded profile; that is exactly what lathe is for.
- **Magazine** — `beveledBox`, angled slightly forward.
- **Stock** — `beveledBox` on rifle/shotgun/sniper; omit on pistol.
- **Sights** — a front post and a rear notch as small beveled boxes. On the sniper, a scope
  body as a `CylinderGeometry` with `TorusGeometry` rings at each end.
- **Grip** — `beveledBox`, angled back about 15°.

Merge each gun's parts with `mergeGeometries` where they share a material so a weapon is
**1–2 draw calls, not 8**. Two shared materials for all guns: gunmetal (`0x222228`,
roughness 0.40, metalness 0.60 — the values already in `viewmodel.js`) and a darker polymer
(`0x15151a`, roughness 0.75, metalness 0.0).

Scale so each weapon reads at the existing viewmodel position `(0.32, -0.28, -0.55)` with
the camera's 0.05 near plane. Rough overall lengths: pistol 0.22 m, rifle 0.50 m, shotgun
0.52 m, sniper 0.62 m.

**Preserve every existing behaviour in `viewmodel.js`:** the per-weapon reshape on switch,
the `kick` decay writing `gun.position.z/y`, the recoil recovery writing
`controller.recoil`, the muzzle flash `visible` toggle at `FLASH_TIME = 0.04`, and the
scoped-state visibility. Only the *geometry* changes. Note that the current code mutates a
**shared** material's colour on weapon switch (`this.body.material.color.setHex`) — with
per-weapon models that is no longer needed; remove it rather than leaving it mutating a
shared material.

Keep the muzzle flash as an unlit `MeshBasicMaterial`.

**Done when:** each of the four weapons is visually distinct in the hand, switching weapons
swaps the model, recoil and muzzle flash behave exactly as before, and the viewmodel is at
most 2 draw calls per weapon.

Commit: `feat: procedural weapon models`

## End of RUN B2 — verify and push (same commands as RUN B1).

---

## Verification, both runs

```bash
npm run check     # syntax only — necessary, never sufficient
npm run probe     # exception check + behaviour blocks; cannot judge an image
```

The probe **can** catch the thing most likely to go wrong here: if hit boxes or colliders
shift, the P1 behaviour blocks change. Treat any change in those as a failure, not a new
baseline.

What needs a human: whether chamfers catch light, whether bots read at distance, whether the
weapons look right in the hand. Record in `docs/PROGRESS.md` what you verified versus what
needs eyes.

If a task fails twice, write what you tried under it in `docs/PROGRESS.md`, mark it `[!]`,
and stop — do not improvise a different approach.
