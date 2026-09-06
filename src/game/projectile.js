import * as THREE from 'three';
import { rayAABB } from '../core/physics.js';

// Thrown-object physics. A `Projectile` is a position/velocity with ballistic
// gravity; it arcs until it strikes the floor or a map collider, or its fuse runs
// out — whichever first — at which point it fires an `onImpact(pos)` callback and its
// mesh is removed from the scene. `ProjectileManager` owns the live set and prunes
// the dead. Reuses `rayAABB` for a swept wall check (no per-frame allocation).
const GRAVITY = 9.8;   // m/s^2, a bit below 9.81 for a floatier, more readable arc
const RADIUS = 0.15;   // the nade's collision sphere radius

// Module-level scratch, reused across projectiles (updates are sequential).
const _prev = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Projectile {
  constructor(scene, pos, vel, opts = {}) {
    this.scene = scene;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.fuse = opts.fuse || 4;
    this.fuseLeft = this.fuse;
    this.alive = true;
    this.onImpact = opts.onImpact || null;
     // A small sphere as the visible nade; color set per kind by the caller.
    this._geo = new THREE.SphereGeometry(RADIUS, 12, 8);
    this._mat = new THREE.MeshLambertMaterial({ color: opts.color || 0xcc3333 });
    this.mesh = new THREE.Mesh(this._geo, this._mat);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
   }

   // Integrate one step: gravity, then a ballistic step, then test floor/wall/fuse.
  update(dt, colliders) {
    if (!this.alive) return;
    this.vel.y -= GRAVITY * dt;
    _prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);

       // Floor: the arc ends the moment the nade lands.
    if (this.pos.y <= RADIUS) { this.pos.y = RADIUS; this._impact(); return; }

       // Walls: a swept segment from the previous to the new position crossing a
     // collider means the nade struck a wall.
    if (colliders) {
      _seg.copy(this.pos).sub(_prev);
      const dist = _seg.length();
      if (dist > 1e-5) {
        _dir.copy(_seg).divideScalar(dist);
        for (const c of colliders) {
          if (rayAABB(_prev, _dir, c.min, c.max, dist) !== null) { this._impact(); return; }
         }
      }
    }

       // A nade that hits nothing yet detonates on its fuse.
    this.fuseLeft -= dt;
    if (this.fuseLeft <= 0) this._impact();

    this.mesh.position.copy(this.pos);
   }

     // Detonate: fire the impact callback once and remove the mesh from the scene.
   _impact() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.remove(this.mesh);
    this._geo.dispose();
    this._mat.dispose();
    if (this.onImpact) this.onImpact(this.pos.clone());
   }
}

// Owns the live projectiles: `throw` spawns one, `update` steps and prunes them.
export class ProjectileManager {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
   }

   throw(pos, vel, opts = {}) {
    const p = new Projectile(this.scene, pos, vel, opts);
    this.list.push(p);
    return p;
   }

  update(dt, colliders) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      this.list[i].update(dt, colliders);
      if (!this.list[i].alive) this.list.splice(i, 1);
     }
   }
}
