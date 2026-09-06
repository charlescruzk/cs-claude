import * as THREE from 'three';

// Opt-in diagnostics, active only when the page URL carries `?debug=1`. Without the
// flag `debugEnabled()` is false and the setup no-ops, so the plain page shows
// neither the FPS readout nor the collider wireframes.
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

export function debugEnabled() {
  return DEBUG;
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
