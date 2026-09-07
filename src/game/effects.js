import * as THREE from 'three';
import { events } from '../core/events.js';
import { rayAABB } from '../core/physics.js';

// Tactical effects, driven by the 'tactical' events P1-5 emits on a nade detonation.
// A frag damages every bot within FRAG_RADIUS (falloff by distance and line of
// sight) and the thrower too — a frag at your own feet is your own fault. A flash
// whiteouts the screen (a full-screen div eased 1 -> 0) if the player has line of
// sight to the impact, and blinds any bot that can see it, scaled by how directly
// it faces the flash. The 3D explosion lives in the scene; the two screen overlays
// are opacities hud.js paints each frame.
const FRAG_RADIUS = 8;      // m, the blast reach
const FRAG_DMG = 100;       // full damage at the center, 0 at the edge
const EXPLOSION_T = 0.3;    // s, the flash sphere's fade
const FRAG_FLASH_T = 0.15; // s, the brief orange screen flash
const WHITEOUT_T = 2.0;     // s, the white-out fade
const FLASH_RANGE = 20;     // m, how far a flash can whiteout
const BLIND_MAX = 3.5;      // s, full-exposure blind duration (bot.js BLIND_HEAVY = 0.45 × this)
const BOT_COM = 0.9;        // m, bot centre of mass — frag blast measures from here
const BOT_EYE = 1.6;        // m, bot eye height — flash exposure measures from here

// Reused across every line-of-sight ray (the flash test runs at most a few times).
const _eye = new THREE.Vector3();
const _ray = new THREE.Vector3();
// Scratch for the bot-facing dot in _flashNade (per detonation, not per frame).
const _facing = new THREE.Vector3();

// How exposed a viewer is to a detonation, 0 (none) to 1 (full). `viewDir` may
// be null for a pure blast check, where facing is irrelevant. The ray scan is
// the one _playerSees used — every consumer shares a single LOS test.
function exposure(eyeX, eyeY, eyeZ, viewDir, pos, colliders, range) {
  const dx = pos.x - eyeX;
  const dy = pos.y - eyeY;
  const dz = pos.z - eyeZ;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > range) return 0;
  if (dist > 1e-3) {
    _eye.set(eyeX, eyeY, eyeZ);
    _ray.set(dx, dy, dz).normalize();
    for (const c of colliders) {
      if (rayAABB(_eye, _ray, c.min, c.max, dist) !== null) return 0;
    }
  }
  let e = 1 - dist / range;
  if (viewDir && dist > 1e-3) {
    // Facing: dot of the eye→detonation direction with viewDir, remapped so
    // straight-on is 1.0, perpendicular ~0.35, directly away ~0.15.
    e *= Math.max(0.15, 0.35 + 0.65 * _ray.dot(viewDir));
  }
  return e;
}

// One geometry and four materials, built once at startup and reused by every
// explosion. Each pooled mesh gets its own material so two simultaneous
// explosions never fight over a shared opacity.
const _explosionGeo = new THREE.SphereGeometry(1, 16, 12);
const _explosionMats = Array.from({ length: 4 }, () => new THREE.MeshBasicMaterial({
  color: 0xff5500, transparent: true, opacity: 1,
  blending: THREE.AdditiveBlending, depthWrite: false,
  }));

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
    // Pool of 4 explosion meshes sharing the one geometry; each gets its own
    // material so two simultaneous explosions don't fight over a shared opacity.
    this._pool = [];
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(_explosionGeo, _explosionMats[i]);
      mesh.visible = false;
      this.scene.add(mesh);
      this._pool.push(mesh);
      }
    events.on('tactical', (e) => this._onTactical(e));
   }

   update(dt) {
      // Advance the fading explosion spheres, pruning the finished ones.
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const ex = this._explosions[i];
      ex.life -= dt;
      if (ex.life <= 0) {
        ex.mesh.visible = false;
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

       // Radius damage to every bot target, falloff by distance and line of
      // sight — a wall between the blast and the target protects it. The thrower
      // is not in getTargets(), so a frag at your own feet is handled separately.
  _frag(pos) {
    for (const bot of this.getTargets()) {
      if (bot.dead) continue;
      const e = exposure(bot.pos.x, bot.pos.y + BOT_COM, bot.pos.z, null, pos, this.colliders, FRAG_RADIUS);
      if (e > 0) bot.takeDamage(FRAG_DMG * e, false, null);
      }
    // Self-damage: the player's eye, same exposure check. Guard this.player.state
    // — main.js assigns it after construction, so it may not exist in every path.
    if (this.player.state) {
      const pe = exposure(this.player.pos.x, this.player.pos.y + this.player.eye,
        this.player.pos.z, null, pos, this.colliders, FRAG_RADIUS);
      if (pe > 0) this.player.state.takeDamage(FRAG_DMG * pe, false, null, 'frag', pos);
      }
    this._spawnExplosion(pos);
    this._flashLeft = FRAG_FLASH_T;
    this.flash = 1;
    }

  _flashNade(pos) {
    if (this._playerSees(pos)) {
      this._whiteoutLeft = WHITEOUT_T;
      this.whiteout = 1;
      }
    // Blind every bot that can see the flash, scaled by how directly it faces it.
    // Duck-typed on `blind` so effects never reach into a bot's internals.
    for (const bot of this.getTargets()) {
      if (bot.dead || typeof bot.blind !== 'function') continue;
      _facing.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      const e = exposure(bot.pos.x, bot.pos.y + BOT_EYE, bot.pos.z, _facing, pos, this.colliders, FLASH_RANGE);
      if (e > 0) bot.blind(BLIND_MAX * e);
      }
    }

       // Can the player's eye see the impact? Within FLASH_RANGE and no collider
      // between eye and impact (a wall between them blocks the whiteout).
  _playerSees(pos) {
    return exposure(this.player.pos.x, this.player.pos.y + this.player.eye,
      this.player.pos.z, null, pos, this.colliders, FLASH_RANGE) > 0;
    }

       // An emissive sphere at the impact that grows to the blast radius and fades
      // out over EXPLOSION_T, then is returned to the pool.
   _spawnExplosion(pos) {
    const mesh = this._pool.find((m) => !m.visible) ?? this._explosions[0].mesh;
    mesh.scale.setScalar(0.3);
    mesh.material.opacity = 1;
    mesh.position.copy(pos);
    mesh.visible = true;
    this._explosions.push({ mesh, life: EXPLOSION_T });
    }
}
