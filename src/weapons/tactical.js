import * as THREE from 'three';
import { events } from '../core/events.js';

// Thrown tacticals. G throws a frag, H throws a flash; one active throw of each.
// Each throw spawns from the camera forward with an initial velocity plus an upward
// arc and is handed to the ProjectileManager, which owns the ballistic, mesh, and
// fuse. The effect itself (splash damage / whiteout) is P1-6; here a detonation just
// emits a `tactical` event the effects layer will react to.
const THROW_SPEED = 14;    // forward m/s
const ARC_UP = 4.5;        // upward m/s, so the throw arcs up and comes back down

// The two nades: a red frag (long fuse) and a yellow flash (short fuse).
const NADES = {
  frag:  { color: 0xcc3333, fuse: 4.0 },
  flash: { color: 0xdddd33, fuse: 1.6 },
};

// Scratch vectors, reused per throw (throws are rare).
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Tactical {
  constructor(projectiles, camera) {
    this.projectiles = projectiles;
    this.camera = camera;
    this._frag = null;    // the in-flight frag, or null
    this._flash = null;   // the in-flight flash, or null
   }

    // Read G/H and clear any slot whose nade has already detonated.
  update(dt, input, camera) {
    this.camera = camera;
    if (this._frag && !this._frag.alive) this._frag = null;
    if (this._flash && !this._flash.alive) this._flash = null;
    if (input.justPressed('KeyG')) this._throw('frag');
    if (input.justPressed('KeyH')) this._throw('flash');
   }

       // Readiness for the HUD indicator: a nade is "held" (available to throw) while
      // its slot is free — update() nulls a slot the moment its nade has detonated.
   ready() {
    return { frag: !this._frag, flash: !this._flash };
    }

     // Spawn one nade of `kind`, but only if that slot is free (one active throw each).
  _throw(kind) {
    const nade = NADES[kind];
    const slot = this[kind === 'frag' ? '_frag' : '_flash'];
    if (slot && slot.alive) return;
    this.camera.getWorldPosition(_origin);
    this.camera.getWorldDirection(_dir);
     // Forward from the eye with an upward arc, offset a meter forward so the nade
    // does not spawn inside the viewmodel.
    _origin.addScaledVector(_dir, 1.0);
    const vel = _dir.clone().multiplyScalar(THROW_SPEED);
    vel.y += ARC_UP;
    this[kind === 'frag' ? '_frag' : '_flash'] =
      this.projectiles.throw(_origin.clone(), vel, {
        color: nade.color,
        fuse: nade.fuse,
        onImpact: (pos) => events.emit('tactical', { kind, pos }),
       });
    }
}
