import * as THREE from 'three';
import { events } from '../core/events.js';
import { rayAABB } from '../core/physics.js';

// Tactical effects, driven by the 'tactical' events P1-5 emits on a nade detonation.
// A frag damages every bot within FRAG_RADIUS (falloff by distance), throws an
// expanding emissive sphere, and a brief orange screen flash; it never self-damages
// the thrower. A flash whiteouts the screen (a full-screen div eased 1 -> 0) only if
// the player has line of sight to the impact. The 3D explosion lives in the scene;
// the two screen overlays are opacities hud.js paints each frame.
const FRAG_RADIUS = 4;      // m, the blast reach
const FRAG_DMG = 100;       // full damage at the center, 0 at the edge
const EXPLOSION_T = 0.3;    // s, the flash sphere's fade
const FRAG_FLASH_T = 0.15; // s, the brief orange screen flash
const WHITEOUT_T = 2.0;     // s, the white-out fade
const FLASH_RANGE = 20;     // m, how far a flash can whiteout

// Reused across every line-of-sight ray (the flash test runs at most a few times).
const _eye = new THREE.Vector3();
const _ray = new THREE.Vector3();

export class Effects {
  constructor({ scene, colliders, player, getTargets }) {
    this.scene = scene;
    this.colliders = colliders;
    this.player = player;        // the controller: carries pos (feet) + eye height
    this.getTargets = getTargets; // () => bot targets to damage
    this.whiteout = 0;          // current white-out opacity, eased 1 -> 0
    this.flash = 0;             // current orange-flash opacity
    this._whiteoutLeft = 0;
    this._flashLeft = 0;
    this._explosions = [];      // { mesh, life } fading spheres
    events.on('tactical', (e) => this._onTactical(e));
   }

   update(dt) {
      // Advance the fading explosion spheres, pruning the finished ones.
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const ex = this._explosions[i];
      ex.life -= dt;
      if (ex.life <= 0) {
        this.scene.remove(ex.mesh);
        ex.mesh.geometry.dispose();
        ex.mesh.material.dispose();
        this._explosions.splice(i, 1);
        continue;
        }
      const t = 1 - ex.life / EXPLOSION_T;  // 0 -> 1 over the fade
      ex.mesh.scale.setScalar(0.3 + t * (FRAG_RADIUS - 0.3));
      ex.mesh.material.opacity = 1 - t;
      }

       // Ease the two screen overlays down to clear.
    if (this._whiteoutLeft > 0) {
      this._whiteoutLeft -= dt;
      this.whiteout = Math.max(0, this._whiteoutLeft / WHITEOUT_T);
      }
    if (this._flashLeft > 0) {
      this._flashLeft -= dt;
      this.flash = Math.max(0, this._flashLeft / FRAG_FLASH_T);
      }
    }

  _onTactical(e) {
    if (e.kind === 'frag') this._frag(e.pos);
    else this._flashNade(e.pos);
    }

       // Radius damage to every bot target, falloff by distance. The frag is a
      // bot's killer, not a source of self-damage, so the thrower is untouched.
  _frag(pos) {
    for (const bot of this.getTargets()) {
      if (bot.dead) continue;
      const d = bot.pos.distanceTo(pos);
      if (d < FRAG_RADIUS) bot.takeDamage(FRAG_DMG * (1 - d / FRAG_RADIUS), false, null);
      }
    this._spawnExplosion(pos);
    this._flashLeft = FRAG_FLASH_T;
    this.flash = 1;
    }

  _flashNade(pos) {
    if (!this._playerSees(pos)) return; // no line of sight, no whiteout
    this._whiteoutLeft = WHITEOUT_T;
    this.whiteout = 1;
    }

       // Can the player's eye see the impact? Within FLASH_RANGE and no collider
      // between eye and impact (a wall between them blocks the whiteout).
  _playerSees(pos) {
    const dx = pos.x - this.player.pos.x;
    const dz = pos.z - this.player.pos.z;
    if (Math.hypot(dx, dz) > FLASH_RANGE) return false;
    _eye.set(this.player.pos.x, this.player.pos.y + this.player.eye, this.player.pos.z);
    _ray.set(pos.x - _eye.x, pos.y - _eye.y, pos.z - _eye.z);
    const len = _ray.length();
    if (len < 1e-3) return true;
    _ray.normalize();
    for (const c of this.colliders) {
      if (rayAABB(_eye, _ray, c.min, c.max, len) !== null) return false;
      }
    return true;
    }

       // An emissive sphere at the impact that grows to the blast radius and fades
      // out over EXPLOSION_T, then is removed from the scene.
   _spawnExplosion(pos) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xff5500, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
         }));
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.3);
    this.scene.add(mesh);
    this._explosions.push({ mesh, life: EXPLOSION_T });
    }
}
