import * as THREE from 'three';

// Opt-in diagnostics, active only when the page URL carries `?debug=1`. Without the
// flag `debugEnabled()` is false and the setup no-ops, so the plain page shows
// neither the FPS readout nor the collider wireframes.
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

export function debugEnabled() {
  return DEBUG;
}

// A parallel ?diag=1 flag: a live state panel (makeDiagPanel) instead of the FPS /
// collider overlay. Without the flag DIAG is false and the setup no-ops, so the
// plain page shows neither the FPS readout nor the diagnostic panel.
const DIAG = new URLSearchParams(location.search).get('diag') === '1';

export function diagEnabled() {
  return DIAG;
}

// A fixed-position FPS readout, updated each frame with a rolling 30-frame average.
// The element is created here (never in index.html), so it exists only when debug is
// on. Returns an `update(dt)` the caller runs once per frame.
export function makeFpsCounter() {
  const el = document.createElement('div');
  el.textContent = 'FPS --';
  el.style.position = 'fixed';
  el.style.top = '8px';
  el.style.left = '8px';
  el.style.zIndex = '999';
  el.style.padding = '4px 6px';
  el.style.font = '13px/1.2 monospace';
  el.style.color = '#0f0';
  el.style.background = 'rgba(0, 0, 0, 0.5)';
  document.body.appendChild(el);

  const samples = [];
  return (dt) => {
    samples.push(dt);
    if (samples.length > 30) samples.shift();
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    el.textContent = 'FPS ' + (avg > 0 ? Math.round(1 / avg) : 0);
  };
}

// One green wireframe box per collider, sized and centered from its min/max. A
// single shared material keeps the group cheap; it is added to the scene by the
// caller.
export function makeColliderBoxes(colliders) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
  for (const c of colliders) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(c.max.x - c.min.x, c.max.y - c.min.y, c.max.z - c.min.z),
      mat
    );
    mesh.position.set(
      (c.min.x + c.max.x) / 2,
      (c.min.y + c.max.y) / 2,
      (c.min.z + c.max.z) / 2
    );
    group.add(mesh);
  }
  return group;
}

// A frozen game must say why. While locked the loop must advance every frame; if
// engine.frames stops climbing the loop has stalled, so report the exact state that
// explains it on #boot-status instead of sitting on a dead frame. On a healthy
// machine the loop always advances while locked, so the watchdog stays silent. It is
// always on (not flag-gated) because it is the only thing that turns a silent freeze
// into a diagnosis.
export function makeFrameWatchdog(engine, input, status, round) {
  let lastFrames = 0;
  setInterval(() => {
    const advancing = engine.frames > lastFrames;
    lastFrames = engine.frames;
    if (!input.locked || advancing) return;
    status.textContent =
          'FRAME LOOP STALLED\n' +
          `frames=${engine.frames} locked=${input.locked} ` +
          `lockEl=${document.pointerLockElement ? document.pointerLockElement.id : 'null'}\n` +
          `visibility=${document.visibilityState} round=${round.state} t=${round.time.toFixed(1)} ` +
          `updateErrored=${engine._reportedError}`;
    status.style.color = '#ff6b6b';
    status.style.whiteSpace = 'pre-wrap';
    }, 1000);
}

// A ?diag=1 live state panel: a fixed div, created here (never in index.html) and
// refreshed every frame with the same fields the watchdog reports, plus fps and the
// player position, so a frozen game shows its own state instead of a dead frame.
// It returns an update(dt) the caller runs once per frame; inert without the flag.
export function makeDiagPanel(engine, input, round, controller) {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.bottom = '8px';
  el.style.left = '8px';
  el.style.zIndex = '999';
  el.style.padding = '4px 6px';
  el.style.font = '12px/1.3 monospace';
  el.style.color = '#0ff';
  el.style.background = 'rgba(0, 0, 0, 0.6)';
  el.style.whiteSpace = 'pre';
  document.body.appendChild(el);

  const samples = []; // rolling dt window, a rolling fps like makeFpsCounter
  return (dt) => {
    samples.push(dt);
    if (samples.length > 30) samples.shift();
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const fps = avg > 0 ? Math.round(1 / avg) : 0;
    const lockEl = document.pointerLockElement ? document.pointerLockElement.id : 'null';
    const p = controller.pos;
    el.textContent =
             `fps=${fps} frames=${engine.frames} locked=${input.locked}\n` +
             `lockEl=${lockEl} visibility=${document.visibilityState}\n` +
             `round=${round.state} t=${round.time.toFixed(1)} ` +
             `pos=(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) ` +
             `updateErrored=${engine._reportedError}`;
     };
}
