# FIX PROMPT 4 — cs-browser: buy-menu blocker, then feel & polish

You are working in the `cs-browser` repo. Read `CLAUDE.md` and `docs/ARCHITECTURE.md`
before you touch anything.

**This document is split into four RUNS. Do one run per session. Do not start a run until
the previous run is committed and verified.** Each run is self-contained.

Every hard constraint applies to every run, without exception:

- **No build step. No npm install. No bundler. No new dependencies of any kind.**
- Three.js comes from the importmap in `index.html`. Do not change the pinned version.
- Vanilla ES modules. `const` by default, `let` when reassigned, never `var`.
- Keep every file under ~300 lines. Split when it grows past that.
- Primitive geometry and procedural canvas textures only. No external images or audio.
- 1 world unit = 1 m. Y is up. Forward is -Z. `dt` in seconds.
- **Never rewrite a working file from scratch. Make targeted edits only.**

After each task: run `npm run check`, then commit that task alone.
If a task fails twice, write what you tried under it in `docs/PROGRESS.md`, mark it `[!]`,
and move to the next task that does not depend on it.

---

## Read this first: the test harness has been lying

`npm run probe` reports green on a feature that is completely broken in real browsers.
`scripts/cs_probe.mjs:91` does:

```js
for (const P of [Element.prototype, HTMLElement.prototype]) {
  P.requestPointerLock = _rq; P.exitPointerLock = _ex;
}
```

`Element.prototype.exitPointerLock` **does not exist in any browser.** `exitPointerLock()`
is defined on `Document`. By inventing it, the probe made `buyMenu.js:46` pass while it
throws a `TypeError` for every real user.

**This governs the whole pass:** a green probe is not evidence a feature works. Before
marking anything done, confirm the browser API you called actually exists on the interface
you called it on. `npm run check` proves syntax only.

---

# RUN 1 — the blocker chain (Tasks 1–3)

Fix these three, commit each, push, stop. The buy menu is dead until all three are done.

## Task 1 — `exitPointerLock` is called on the wrong object

`src/hud/buyMenu.js:46`, in `open()`:

```js
this.input.canvas.exitPointerLock(); // free the mouse (the probe stubs this)
```

`canvas` is an `HTMLCanvasElement` and has no `exitPointerLock`. This throws
`TypeError: this.input.canvas.exitPointerLock is not a function` the moment `B` is pressed.

The blast radius is bigger than a dead menu. `main.js:158` calls `buyMenu.update(...)` one
line **before** `input.endFrame()` at `main.js:159`, so the throw skips `endFrame()` every
frame: `_pressed` never clears (so `justPressed('KeyB')` stays true forever and the panel
toggles every frame) and `mouseDX`/`mouseDY` never zero (so `controller.look()` re-applies
the same delta each frame and the camera spins on its own).

**Change line 46 to exactly:**

```js
    document.exitPointerLock(); // free the mouse so the panel can be clicked
```

Change nothing else in this file. `close()` calls `this.input.requestLock()`, which is
correct — `requestPointerLock` really is an element method. Leave it.

**Done when:** pressing `B` in freeze opens the panel with no console error and the camera
does not spin.

Commit: `fix: exitPointerLock is a Document method, not an Element method`

## Task 2 — Make the probe test reality

`scripts/cs_probe.mjs`, line 91. Replace that single line with exactly:

```js
     // requestPointerLock is an Element method; exitPointerLock is a Document method.
     // Stubbing the latter onto Element lets a wrong call site pass the probe.
     "for (const P of [Element.prototype, HTMLElement.prototype]) { P.requestPointerLock = _rq; }",
     "Document.prototype.exitPointerLock = _ex;",
```

Keep the surrounding array syntax and quoting intact — this is a list of strings evaluated
in the page, so match the existing style exactly.

**Then prove the probe can fail.** Temporarily put the old broken call back in
`buyMenu.js:46`, run `npm run probe`, and confirm it now reports the exception. Then restore
`document.exitPointerLock()`. Write one line in `docs/PROGRESS.md` saying you confirmed
this. A probe that cannot fail is worthless.

Commit: `fix: probe stubs exitPointerLock on Document so a wrong call site fails`

## Task 3 — The lock overlay covers the buy menu

Opening the buy menu releases pointer lock, which fires `pointerlockchange`, which runs
`input._onLockChange(false)` at `src/main.js:39`:

```js
input._onLockChange = (locked) => overlay.classList.toggle('hidden', locked);
```

That **un-hides `#lock-overlay`** — a full-screen `inset: 0` "Click to play" panel with
`cursor: pointer` and a click handler — right on top of the open buy menu. Clicking outside
the panel re-locks the pointer and hides the cursor while the menu is still open.

**Fix:** the overlay must stay hidden while the buy menu is showing. In `src/main.js`,
change the handler so it keeps the overlay hidden when `buyMenu` is open:

```js
// The buy menu deliberately releases pointer lock so the panel can be clicked;
// the overlay must not re-arm on top of it. It re-arms when the menu closes.
input._onLockChange = (locked) => {
  overlay.classList.toggle('hidden', locked || buyMenu._shown);
};
```

`buyMenu` is declared at `main.js:111`, above the handler at line 39 — so **move the
handler assignment to after the `buyMenu` declaration**, or the reference is undefined at
call time. Verify the ordering; do not skip this.

Then in `src/hud/buyMenu.js`, `close()` must re-evaluate the overlay after `_shown` goes
false. `close()` already calls `this.input.requestLock()`; if that lock succeeds,
`_onLockChange(true)` hides the overlay anyway. If it fails, the overlay must re-arm — that
is the correct behaviour, so no extra code is needed. Confirm this by reading the flow.

**Done when:** opening the buy menu shows the panel with a visible cursor and no
"Click to play" behind it; closing it re-arms the overlay exactly as before.

Commit: `fix: lock overlay stays hidden while the buy menu is open`

## End of RUN 1 — push

```bash
npm run check
npm run probe
git fetch origin
git push origin main
git rev-list --count origin/main..main     # must print 0
```

A plain fast-forward push works — local and `origin/main` share history now. You do **not**
need `--force`. If the push is rejected, stop and report it rather than forcing.

---

# RUN 2 — physics feel (Tasks 4–5)

## Task 4 — Acceleration and friction

`src/player/playerController.js`, `horizontal()`. Movement is instantaneous today:

```js
this.vel.x = dx * speed;
this.vel.z = dz * speed;
```

Velocity snaps to full on keydown and zero on keyup — no momentum. This is the main reason
it does not feel like 1.6.

Add these constants beside the existing ones at the top of the file. **Use these exact
values; do not invent your own.**

```js
const FRICTION = 5.5;      // ground friction coefficient, per second
const STOP_SPEED = 1.0;    // m/s floor used in the friction drop calculation
const GROUND_ACCEL = 12;   // ground acceleration coefficient
const AIR_ACCEL = 12;      // air acceleration coefficient
const AIR_WISH_CAP = 0.8;  // m/s — the cap that makes air-strafing work
```

Keep the existing `RUN` / `WALK` / `CROUCH` constants — they become the **target** speed
(`wishSpeed`), not the applied speed.

**First change the signature** from `horizontal()` to `horizontal(dt)`, and the call site in
`update()` from `this.horizontal();` to `this.horizontal(dt);` — the model below needs `dt`
and the method does not currently receive it. Do not add a `this._dt` field.

Then replace the two direct velocity assignments with this exact model. `dx`/`dz` stay as
the normalized wish direction already computed above them:

```js
    // Ground friction: scale speed down toward zero, with a floor so slow speeds
    // still shed velocity at a usable rate. Below the threshold, snap to a stop.
    if (this.grounded) {
      const speed2 = Math.hypot(this.vel.x, this.vel.z);
      if (speed2 < 0.1) {
        this.vel.x = 0;
        this.vel.z = 0;
      } else {
        const drop = Math.max(speed2, STOP_SPEED) * FRICTION * dt;
        const scale = Math.max(speed2 - drop, 0) / speed2;
        this.vel.x *= scale;
        this.vel.z *= scale;
      }
    }

    // Accelerate toward the wish direction, adding only the shortfall against the
    // target speed. In the air the wish speed is capped, which is what lets a
    // strafing player steer their trajectory mid-jump.
    const wishSpeed = this.grounded ? speed : Math.min(speed, AIR_WISH_CAP);
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const current = this.vel.x * dx + this.vel.z * dz;
    const add = wishSpeed - current;
    if (add > 0) {
      const accelSpeed = Math.min(accel * wishSpeed * dt, add);
      this.vel.x += dx * accelSpeed;
      this.vel.z += dz * accelSpeed;
    }
```

Note `len > 0` already guards the normalize above; when no key is held, `dx`/`dz` are 0 and
`add` will not push velocity anywhere — friction alone brings you to rest. Verify that
reading before you commit.

**Done when:** a standing start ramps up over roughly a fifth of a second, releasing keys
slides briefly to a stop, and holding a strafe key while turning in mid-air curves your
trajectory.

Commit: `feat: acceleration and friction movement model`

## Task 5 — You can stand up inside a ceiling

`src/player/playerController.js`, end of `vertical()`:

```js
this.height = this.crouching ? CROUCH_H : STAND_H;
this.eye = this.crouching ? CROUCH_EYE : STAND_EYE;
```

Nothing checks headroom. Crouch under a 1.5 m gap, release Ctrl, and the capsule grows from
1.2 m to 1.8 m straight through the geometry above.

Two changes:

**(a) Block the stand when blocked.** Before growing the capsule, test a stand-height
capsule at the current position against the colliders. If it overlaps, stay crouched this
frame. Use the existing overlap helper exported from `src/core/physics.js` — read that file
and reuse what is there. **Do not write a second collision routine.**

**(b) Ease the eye height.** Replace the instant eye assignment with an exponential ease
toward the target, using the same pattern already in `src/main.js:143` for the scope FOV:

```js
    const targetEye = this.crouching ? CROUCH_EYE : STAND_EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-dt / 0.06));
```

`this.height` stays a hard switch — only the camera eases. Leave `spawnAt()` setting both
directly.

**Done when:** crouching under a low overhang and releasing Ctrl keeps you crouched until
you walk clear, and the camera glides between heights instead of teleporting 0.6 m.

Commit: `fix: block standing into geometry, ease crouch eye height`

## End of RUN 2 — `npm run check`, `npm run probe`, push (same commands as RUN 1).

---

# RUN 3 — graphics (Tasks 6–8) — ⛔ SUPERSEDED, DO NOT DO THIS RUN

**Stop. This run has been replaced by `docs/PHASE2_STAGE_A.md`.** Its three tasks are
absorbed there in a corrected form. In particular, Task 8 below tells you to use
`tex.clone()` for per-surface texture repeat — that approach is **wrong** once static
geometry is merged, and is replaced by UV scaling in `PHASE2_STAGE_A.md` RUN A2 Task 3.

Skip straight from RUN 2 to `docs/PHASE2_STAGE_A.md`. RUN 4 below is still valid and still
queued for later.

The original text is kept only for history:

## Task 6 — Renderer output and tone mapping

`src/core/engine.js`, constructor, on the existing `this.renderer`. Add exactly:

```js
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
```

Then in `src/map/textures.js`, every texture used as a **color** map must be marked
`tex.colorSpace = THREE.SRGBColorSpace;` or it renders washed out under tone mapping. Any
data-style map (roughness, normal) must **not** be marked. Read the file and apply this to
the color textures only.

**Done when:** the map has tonal range instead of flat grey and no texture looks bleached.

Commit: `feat: sRGB output and ACES filmic tone mapping`

## Task 7 — Sun shadows

`src/core/engine.js`. `this.sun` is a `DirectionalLight` at `(60, 90, 40)` casting no
shadow, so every box floats with no ground contact.

Add exactly, after the sun is created:

```js
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // A tight ortho frustum around the play area — a loose one spends the whole
    // shadow map on empty space and gives blocky, swimming shadows.
    const s = this.sun.shadow.camera;
    s.left = -45; s.right = 45; s.top = 45; s.bottom = -45;
    s.near = 1; s.far = 220;
    s.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
```

Then in `src/map/mapBuilder.js`, set `castShadow = true` and `receiveShadow = true` on the
box meshes, and `receiveShadow = true` only (no cast) on the ground plane.

If shadow acne appears, adjust `bias` / `normalBias` only. **Do not raise `mapSize` above
2048** — it costs frame rate for no visible gain at this scale.

**Done when:** boxes and walls drop grounded shadows, with no acne (dark stripes) and no
peter-panning (shadow detached from its object), and `?debug=1` still shows a stable FPS.

Commit: `feat: sun shadow mapping with a fitted ortho frustum`

## Task 8 — Texture filtering

`src/map/textures.js`. The procedural canvas textures have no filtering configuration, so
surfaces shimmer at distance and blur at grazing angles, and a 30 m wall is stretched next
to a 3 m crate.

For each texture, set:

```js
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
```

Then make texel density consistent: set `tex.repeat` per surface from its real size in
metres, **one texture tile per 2 metres**. A 30 × 4 m wall gets `repeat.set(15, 2)`; a
3 × 3 m crate face gets `repeat.set(1.5, 1.5)`. The sizes are in `src/map/mapData.js`.
Because `repeat` is per-texture, you will need a per-surface texture instance or a clone —
`tex.clone()` shares the underlying image, so cloning is cheap. Do not generate the canvas
more than once per texture kind.

**Done when:** the floor does not shimmer as you walk, and tiling looks the same scale on a
long wall as on a small crate.

Commit: `feat: mipmaps, anisotropy, and metre-consistent texture tiling`

## End of RUN 3 — `npm run check`, `npm run probe`, push.

---

# RUN 4 — UX (Tasks 9–10)

## Task 9 — Keyboard-driven buy menu

`src/hud/buyMenu.js`. Only after RUN 1 is committed and verified.

- `Digit1` / `Digit2` / `Digit3` buy the matching item while the panel is open.
- `Escape` closes the panel, in addition to `B`.
- Add an **owned** state visually distinct from the existing `.poor` (unaffordable) state —
  owned Kevlar must not look identical to Kevlar you cannot afford. Add a `.owned` class in
  the `#buy-menu .bm-item` CSS block in `index.html` and toggle it in `_refresh()`.

Route every key through the existing `input.justPressed(...)` edge detection in
`update(dt, input)`. **Do not add a `keydown` listener** — `src/core/input.js` already owns
keyboard state, and a second listener will double-fire.

**Done when:** a full buy completes on the keyboard alone and Escape closes the panel.

Commit: `feat: keyboard shortcuts and owned state in the buy menu`

## Task 10 — Hit feedback

- **Hitmarker:** a brief crosshair flourish on a confirmed hit, visually distinct for a
  headshot. Drive it from the existing `hit` event. `src/game/effects.js` and
  `src/hud/hud.js` already have the event plumbing and a per-frame fade pattern — follow it
  exactly rather than inventing a new mechanism.
- **Damage direction:** `#vignette` in `index.html` already flashes red on damage. Extend
  that to indicate the direction the damage came from. Do not add a new full-screen element.

Keep both subtle — this is a readability aid, not a light show.

**Done when:** landing a shot gives instant feedback, a headshot is distinguishable, and
taking fire shows where it came from.

Commit: `feat: hitmarker and directional damage indicator`

## End of RUN 4 — `npm run check`, `npm run probe`, push.

---

## Verification, every run

```bash
npm run check     # syntax only — necessary, never sufficient
npm run probe     # real headless Chrome; see the warning at the top of this file
```

The probe cannot judge pointer lock, shadows, texture filtering, or movement feel. For
those, reason about the code and the real browser API, and state plainly in
`docs/PROGRESS.md` what you verified versus what you could not. Never claim a visual or
feel change is correct because `npm run check` passed.
