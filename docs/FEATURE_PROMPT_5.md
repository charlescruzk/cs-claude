# FEATURE PROMPT 5 — cs-browser: procedural audio, then controls & settings

You are working in the `cs-browser` repo. Read `CLAUDE.md` and `docs/ARCHITECTURE.md`
before you touch anything.

**This document is split into two RUNS. Do one run per session.** RUN 5 (audio) is
self-contained and additive. RUN 6 (settings) depends on RUN 5 only for the volume slider.

Every hard constraint applies, without exception:

- **No build step. No npm install. No bundler. No new dependencies of any kind.**
- **No audio files.** No `.wav`, `.mp3`, `.ogg`, no base64-embedded audio, no CDN audio.
  Every sound in this game is **synthesized at runtime with the Web Audio API**. This is not
  a stylistic preference — external assets are forbidden by `CLAUDE.md`.
- Three.js comes from the importmap. Do not change the pinned version.
- Vanilla ES modules. `const` by default, `let` when reassigned, never `var`.
- Keep every file under ~300 lines. Split when it grows past that.
- `dt` in seconds, passed into every `update(dt)`.
- **Never rewrite a working file from scratch. Make targeted edits only.**

After each task: run `npm run check`, then commit that task alone.

---

## Read this first: two failure modes that are silent

This project has twice shipped code that passed every automated check and was completely
broken for real users (`buyMenu.js` called `exitPointerLock` on the wrong object; the probe
stubbed a DOM method that does not exist). Audio has the same shape of trap:

1. **An `AudioContext` starts in the `suspended` state.** Browsers block audio until a user
   gesture. If you create the context at module load and never `resume()` it inside a real
   click handler, **every sound silently does nothing** — no error, no warning, nothing in
   the console. Task 11 handles this explicitly. Do not skip it.

2. **`exponentialRampToValueAtTime` cannot target zero.** Passing `0` throws or produces
   silence depending on the browser. Always ramp to a small positive value like `0.001`.

3. **The probe cannot test audio.** Headless Chrome has no audio device. `npm run probe`
   passing tells you nothing about whether a sound is audible. Never claim a sound works
   because the probe is green.

---

# RUN 5 — procedural audio (Tasks 11–14)

## Task 11 — Audio core, unlocked on a user gesture

Create `src/audio/audio.js`. It owns exactly one `AudioContext` and a master gain, and
nothing else in the codebase may create a second one.

```js
// One AudioContext for the whole game, plus a master gain every voice routes through.
// A context is created 'suspended' — browsers require a user gesture before audio can
// start — so resume() must be called from inside a real click handler. Until then every
// sound is silently dropped, with no error anywhere.
export class Audio {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.enabled = true;
    this._noise = this._makeNoise(1.0); // one shared white-noise buffer, reused per voice
  }

  // Resume the context. Safe to call repeatedly; must be called from a user gesture.
  unlock() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  // One second of white noise, generated once and shared by every noise-based voice.
  // Generating a buffer per shot would allocate ~200 KB per trigger.
  _makeNoise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
```

Then wire the unlock in `src/main.js`. The overlay click handler at `main.js:38` is already
a real user gesture — the ideal place:

```js
overlay.addEventListener('click', () => { audio.unlock(); input.requestLock(); });
```

The buy menu also releases and re-requests the lock, so add `audio.unlock()` in
`BuyMenu.close()` too — cheap and idempotent.

**Done when:** `window.__game.audio.ctx.state` reads `'running'` after clicking to play.
Add `audio` to the `window.__game` object so this is checkable.

Commit: `feat: audio context with gesture unlock and shared noise buffer`

## Task 12 — Weapon fire, synthesized

Create `src/audio/sfx.js`. It takes the `Audio` instance and exposes one method per sound.
Keep `audio.js` to the context and `sfx.js` to the voices — do not merge them.

A gunshot is a noise burst through a lowpass sweeping downward, with a fast gain decay:

```js
// A gunshot: white noise through a lowpass swept downward, with a near-instant attack
// and an exponential decay. Louder/longer/darker = bigger gun.
shot(kind) {
  if (!this.audio.enabled) return;
  const ctx = this.audio.ctx;
  const p = SHOT[kind] || SHOT.pistol;
  const t = ctx.currentTime;

  const src = ctx.createBufferSource();
  src.buffer = this.audio._noise;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(p.startHz, t);
  lp.frequency.exponentialRampToValueAtTime(p.endHz, t + p.decay);

  const g = ctx.createGain();
  g.gain.setValueAtTime(p.gain, t);
  // Never ramp exponentially to 0 — it throws or silences. 0.001 is effectively silent.
  g.gain.exponentialRampToValueAtTime(0.001, t + p.decay);

  src.connect(lp);
  lp.connect(g);
  g.connect(this.audio.master);
  src.start(t);
  src.stop(t + p.decay + 0.02);
}
```

Use exactly this parameter table:

```js
const SHOT = {
  pistol:  { startHz: 3200, endHz: 260, decay: 0.11, gain: 0.35 },
  rifle:   { startHz: 4200, endHz: 200, decay: 0.16, gain: 0.45 },
  shotgun: { startHz: 2200, endHz: 120, decay: 0.28, gain: 0.55 },
  sniper:  { startHz: 5000, endHz: 150, decay: 0.34, gain: 0.60 },
};
```

Subscribe to the existing event bus rather than calling into the weapon code. `src/main.js`
already does `events.on('shot', ...)` at line 80 — add a sibling listener; do **not** modify
the existing one. The payload carries `p.weapon`, which is your `kind`.

**Done when:** each of the four weapons has a distinct report, and a shotgun blast is one
sound rather than eight (the `shot` event fires once per pull, with `pellets` inside it).

Commit: `feat: synthesized weapon fire`

## Task 13 — Impact, hit, and tactical sounds

Still in `src/audio/sfx.js`. Subscribe to the existing events — read `src/core/events.js`
and `src/game/effects.js` to confirm the exact names and payloads before wiring anything.

- **`hit` on an enemy** — a short bright tick (~40 ms). A headshot gets a second, higher
  tick layered on top so it is instantly distinguishable by ear.
- **Taking damage** — a duller, lower thud, clearly different from dealing damage.
- **Reload** — two short filtered clicks about 90 ms apart (magazine out, magazine in).
- **Frag detonation** — a longer, lower noise burst than a shotgun: `startHz` around 900,
  `endHz` around 60, decay near 0.8, plus a low sine thump around 55 Hz.
- **Flash detonation** — a bright noise crack, then a sustained high sine "ring" that fades
  over roughly 2.5 s, matching the whiteout duration in `src/game/effects.js`. Read the
  actual fade time there and match it rather than guessing.

Use sine/triangle oscillators for tonal elements and the shared noise buffer for the rest.

**Cap concurrent voices.** Bots firing plus grenades can trigger many voices at once. Track
active voices and drop new ones past 16 — a dropped sound is better than a distorted mix.

**Done when:** hits, headshots, taking damage, reloads, and both grenades are audible and
distinct, and sustained bot fire does not clip or crackle.

Commit: `feat: impact, hit, reload, and tactical audio`

## Task 14 — Footsteps and movement

Footsteps are what make an FPS feel physical, and in CS they are also information.

Drive them from **distance travelled**, not from a timer — a walking player must step less
often than a running one, and this falls out for free. In `src/player/playerController.js`,
accumulate horizontal distance moved while `grounded`, and emit a `step` event on the
existing `events` bus each time the accumulator passes a stride length. Use **2.0 m** while
running and **2.8 m** while walking (Shift). Reset the accumulator when airborne.

Crouching (Ctrl) must emit **no** footstep at all — silent movement while crouched is a
core CS mechanic and a real tactical affordance.

In `sfx.js`, a footstep is a very short filtered noise burst (~60 ms, bandpass near 900 Hz)
with small random pitch variation per step so it does not sound like a metronome.

Also add a **landing** sound on the frame `grounded` goes from false to true, scaled by
impact speed — heavier for a longer fall.

Do not import audio into `playerController.js`. It emits an event; `sfx.js` listens. Keep
the physics layer free of audio dependencies.

**Done when:** running steps are faster than walking steps, crouching is silent, and landing
from a jump is audible.

Commit: `feat: distance-driven footsteps and landing audio`

## End of RUN 5 — verify and push

```bash
npm run check
npm run probe          # proves nothing about audio; it must still pass
git fetch origin
git push origin main
git rev-list --count origin/main..main     # must print 0
```

In `docs/PROGRESS.md`, state plainly that audio was **not** verified by the probe and list
what a human needs to check by ear.

---

# RUN 6 — controls & settings (Tasks 15–17)

## Task 15 — Central keybinding map

Key codes are currently hardcoded across the codebase: `KeyW`/`KeyA`/`KeyS`/`KeyD` in
`playerController.js`, `Digit1`–`Digit4` and `KeyR` in `weapon.js`, `KeyG`/`KeyH` in
`tactical.js`, `KeyB` in `buyMenu.js`, `Tab` in `scoreboard.js`. Nothing can be rebound.

Create `src/core/bindings.js` holding a default **action → `KeyboardEvent.code`** map:

```js
export const DEFAULT_BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'ControlLeft', walk: 'ShiftLeft',
  reload: 'KeyR', buy: 'KeyB', scoreboard: 'Tab',
  frag: 'KeyG', flash: 'KeyH',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4',
};
```

Use `KeyboardEvent.code`, never `.key` — `code` is physical-layout independent, so WASD
still works on AZERTY. The codebase already uses `code` throughout; keep it that way.

Add two methods to `src/core/input.js` that resolve an action through the map:
`isDown(action)` and `justPressedAction(action)`. **Keep the existing `keys` /
`justPressed(code)` API working** — other code depends on it, and this must be a strictly
additive change.

Then migrate the call sites listed above to the action API, one file per commit. Behaviour
must not change with default bindings.

**Done when:** every gameplay key routes through the map, defaults behave exactly as before,
and `npm run probe` stays green (it presses codes directly, which must still work).

Commit one per file: `refactor: <file> reads bindings by action`

## Task 16 — Settings panel on the pause overlay

Do **not** invent a new key for settings. `Escape` always releases pointer lock and browsers
do not let a page intercept it, so a settings menu bound to Escape fights the browser.

Instead: **`#lock-overlay` is already the pause screen.** Any unlock — Escape included —
shows it. Add a `Settings` button to it in `index.html`, opening a DOM panel that follows
the existing `#buy-menu` pattern (see `src/hud/buyMenu.js` and its CSS block).

Create `src/hud/settings.js` with:

- **Mouse sensitivity** slider. `SENS` is currently a module constant at
  `playerController.js:17` — move it to a mutable field on the controller, set from settings.
- **Master volume** slider, calling `audio.setVolume(v)` from Task 11.
- **Audio on/off** toggle, setting `audio.enabled`.
- **Key rebinding**: a row per action; clicking it captures the next `keydown` as that
  action's new code.
- **Reset to defaults** button.

Rebinding has two traps you must handle:

1. The captured `keydown` must **not** also fire its normal game action that frame. Set a
   capture flag that `input` checks before recording the press.
2. Binding a code already used by another action must be rejected or must clear the other
   binding. Silently allowing duplicates makes the game unplayable with no visible cause.

**Done when:** sensitivity and volume change live, a rebound key works immediately, and
rebinding cannot produce a duplicate or trigger the bound action while capturing.

Commit: `feat: settings panel with sensitivity, volume, and key rebinding`

## Task 17 — Persist settings

Save bindings, sensitivity, and volume to `localStorage` under a single key, and load them
at boot.

**`localStorage` can throw.** Private-browsing modes and blocked-cookie settings raise on
access, not just on write. Wrap **every** read and write in `try`/`catch` and fall back to
defaults — an exception here at module load would kill the whole game before it boots, which
is exactly the class of failure this project has already shipped twice.

Validate on load: a stored binding for an action that no longer exists, or a stored value of
the wrong type, must fall back to the default rather than propagating a broken map.

**Done when:** settings survive a reload, and clearing site data returns clean defaults with
no error.

Commit: `feat: persist settings to localStorage`

## End of RUN 6 — verify and push (same commands as RUN 5).

---

## Verification, both runs

```bash
npm run check     # syntax only — necessary, never sufficient
npm run probe     # cannot hear audio and does not open the settings panel
```

For everything the probe cannot reach — audio, sliders, rebinding, persistence — reason
about the code and the real browser API, and state plainly in `docs/PROGRESS.md` what you
verified versus what needs a human. Do not claim a sound is audible or a slider works
because `npm run check` passed.
