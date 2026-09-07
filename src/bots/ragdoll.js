import * as THREE from 'three';

// A verlet ragdoll for the humanoid in src/geo/humanoid.js. Sixteen particles sit
// on the figure's joints and are held together by distance constraints; each frame
// the limb meshes are re-posed between the joints they span. Particles collide
// with the floor and the map's AABB colliders. No angular state, no library —
// verlet integration makes the constraints do the work.
const GRAVITY = 20;      // matches the player
const H = 1 / 90;        // fixed substep
const MAX_STEPS = 4;
const ITERS = 5;
const DAMP = 0.985;      // velocity retained per substep
const FRICTION = 0.55;   // horizontal velocity shed on contact
const RADIUS = 0.08;     // particle radius for collision
const SLEEP_SPEED = 0.03;
const SLEEP_AFTER = 0.8; // seconds under SLEEP_SPEED before freezing
const HARD_STOP = 8;     // seconds, whatever happens

// Joint positions in the figure's local frame (feet at y=0).
const JOINTS = {
  head: [0, 1.72, 0], neck: [0, 1.56, 0], chest: [0, 1.30, 0], hips: [0, 0.92, 0],
  shL: [-0.30, 1.52, 0], shR: [0.30, 1.52, 0],
  elL: [-0.30, 1.20, 0], elR: [0.30, 1.20, 0],
  hnL: [-0.30, 0.89, 0], hnR: [0.30, 0.89, 0],
  hpL: [-0.11, 0.84, 0], hpR: [0.11, 0.84, 0],
  knL: [-0.11, 0.40, 0], knR: [0.11, 0.40, 0],
  ftL: [-0.11, 0.02, 0], ftR: [0.11, 0.02, 0],
};

// [a, b] pairs held at their bind distance; the third entry marks a minimum-only
// constraint that stops a joint folding through itself.
const LINKS = [
  ['head', 'neck'], ['neck', 'chest'], ['chest', 'hips'],
  ['neck', 'shL'], ['neck', 'shR'], ['chest', 'shL'], ['chest', 'shR'], ['shL', 'shR'],
  ['shL', 'elL'], ['elL', 'hnL'], ['shR', 'elR'], ['elR', 'hnR'],
  ['hips', 'hpL'], ['hips', 'hpR'], ['hpL', 'hpR'], ['chest', 'hpL'], ['chest', 'hpR'],
  ['hpL', 'knL'], ['knL', 'ftL'], ['hpR', 'knR'], ['knR', 'ftR'],
  ['head', 'chest'], ['neck', 'hips'], ['shL', 'hpR'], ['shR', 'hpL'],
  ['shL', 'hnL', 'min'], ['shR', 'hnR', 'min'], ['hpL', 'ftL', 'min'], ['hpR', 'ftR', 'min'],
  ['head', 'hips', 'min'],
];

// Each mesh is posed between two joints: centred by `t` along lower→upper and
// oriented so its local +Y runs from lower to upper.
const POSE = {
  head:      ['neck', 'head', 0.625],
  torso:     ['hips', 'neck', 0.5],
  pelvis:    ['hips', 'chest', -0.1],
  upperArmL: ['elL', 'shL', 0.5], upperArmR: ['elR', 'shR', 0.5],
  lowerArmL: ['hnL', 'elL', 0.5], lowerArmR: ['hnR', 'elR', 0.5],
  thighL:    ['knL', 'hpL', 0.5], thighR:    ['knR', 'hpR', 0.5],
  shinL:     ['ftL', 'knL', 0.5], shinR:     ['ftR', 'knR', 0.5],
  pauldronL: ['elL', 'shL', 1.06], pauldronR: ['elR', 'shR', 1.06],
};

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Ragdoll {
  // `parts` from buildHumanoid; `root` is the figure's group, whose current world
  // transform seeds the joint positions. After construction the caller must reset
  // root to identity, since meshes are then posed in world space.
  constructor(parts, root) {
    this.parts = parts;
    this.p = {};    // current positions
    this.prev = {}; // previous positions (verlet)
    root.updateMatrixWorld(true);
    for (const [name, j] of Object.entries(JOINTS)) {
      const w = new THREE.Vector3(j[0], j[1], j[2]).applyMatrix4(root.matrixWorld);
      this.p[name] = w;
      this.prev[name] = w.clone();
    }
    this.links = LINKS.map(([a, b, mode]) => ({
      a, b, minOnly: mode === 'min', rest: this.p[a].distanceTo(this.p[b]),
    }));
    this._acc = 0;
    this._age = 0;
    this._still = 0;
    this.asleep = false;
  }

  // Kick the upper body along `dir` (unit, world) — the killing shot.
  impulse(dir, strength = 2.6, headshot = false) {
    const push = (name, k) => { this.prev[name].addScaledVector(dir, -strength * k * H); };
    push('chest', 1.0); push('neck', 1.0); push('shL', 0.8); push('shR', 0.8);
    push('head', headshot ? 1.8 : 1.0);
    push('hips', 0.4);
    // A touch of lift so the fall reads as a body dropping, not sliding. Kept
    // small: the first pass launched limbs a metre into the air.
    for (const name of ['chest', 'neck', 'hips']) this.prev[name].y -= 0.5 * H;
  }

  update(dt, colliders) {
    if (this.asleep) return;
    this._acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this._acc >= H && steps < MAX_STEPS) {
      this._step(colliders);
      this._acc -= H;
      steps++;
    }
    if (steps === MAX_STEPS) this._acc = 0;
    this._pose();
  }

  _step(colliders) {
    let maxV = 0;
    for (const name of Object.keys(JOINTS)) {
      const p = this.p[name];
      const q = this.prev[name];
      _tmp.subVectors(p, q).multiplyScalar(DAMP);
      q.copy(p);
      p.add(_tmp);
      p.y -= GRAVITY * H * H;
      const v = _tmp.length();
      if (v > maxV) maxV = v;
    }
    for (let i = 0; i < ITERS; i++) {
      for (const l of this.links) this._satisfy(l);
      for (const name of Object.keys(JOINTS)) this._collide(this.p[name], this.prev[name], colliders);
    }
    this._age += H;
    this._still = maxV / H < SLEEP_SPEED ? this._still + H : 0;
    if (this._still > SLEEP_AFTER || this._age > HARD_STOP) this.asleep = true;
  }

  _satisfy(l) {
    const a = this.p[l.a];
    const b = this.p[l.b];
    _dir.subVectors(b, a);
    const d = _dir.length();
    if (d < 1e-6) return;
    if (l.minOnly && d >= l.rest) return;
    const k = (d - l.rest) / d * 0.5;
    _dir.multiplyScalar(k);
    a.add(_dir);
    b.sub(_dir);
  }

  _collide(p, prev, colliders) {
    let touching = false;
    if (p.y < RADIUS) { p.y = RADIUS; touching = true; }
    for (const c of colliders) {
      const minX = c.min.x - RADIUS, maxX = c.max.x + RADIUS;
      const minY = c.min.y - RADIUS, maxY = c.max.y + RADIUS;
      const minZ = c.min.z - RADIUS, maxZ = c.max.z + RADIUS;
      if (p.x <= minX || p.x >= maxX || p.y <= minY || p.y >= maxY || p.z <= minZ || p.z >= maxZ) continue;
      // Push out along the axis of least penetration.
      const dx = Math.min(p.x - minX, maxX - p.x);
      const dy = Math.min(p.y - minY, maxY - p.y);
      const dz = Math.min(p.z - minZ, maxZ - p.z);
      if (dy <= dx && dy <= dz) p.y = (p.y - minY < maxY - p.y) ? minY : maxY;
      else if (dx <= dz) p.x = (p.x - minX < maxX - p.x) ? minX : maxX;
      else p.z = (p.z - minZ < maxZ - p.z) ? minZ : maxZ;
      touching = true;
    }
    if (touching) {
      // Friction: pull the previous position toward the current one horizontally.
      prev.x += (p.x - prev.x) * FRICTION;
      prev.z += (p.z - prev.z) * FRICTION;
    }
  }

  // Place every mesh between its two joints, in world space.
  _pose() {
    for (const [name, [lo, hi, t]] of Object.entries(POSE)) {
      const mesh = this.parts[name];
      if (!mesh) continue;
      const a = this.p[lo];
      const b = this.p[hi];
      mesh.position.lerpVectors(a, b, t);
      _dir.subVectors(b, a);
      if (_dir.lengthSq() > 1e-8) mesh.quaternion.setFromUnitVectors(UP, _dir.normalize());
    }
  }
}
