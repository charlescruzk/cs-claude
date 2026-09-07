import * as THREE from 'three';
import { events } from '../core/events.js';
import { resolveCapsuleVsBoxes, rayAABB } from '../core/physics.js';
import { buildHumanoid, resetPose } from '../geo/humanoid.js';
import { Ragdoll } from './ragdoll.js';
import { waypoints } from './botData.js';

// Tunables (all times in seconds).
const SPEED = 3.5;      // patrol speed
const ENGAGE_DIST = 30; // see the player within 30 m
const FIRE_RATE = 0.25; // fire every 0.25 s while engaged
const BOT_DAMAGE = 12;  // damage per hit
const MISS = 0.2;       // 20% of shots miss
const LOSE_LOS = 2.0;   // disengage 2 s after losing sight
const EYE = 1.6;        // bot eye height
const RADIUS = 0.4;
const HEIGHT = 1.8;
const BODY = 0.8;       // body box side
const REACH = 1.5;      // a waypoint counts reached within this distance
const TEAM_COLOR = { ct: 0x3355cc, t: 0xcc6633 };

// LOS and patrol rays reuse this scratch (every bot tests every frame).
const _move = new THREE.Vector3();
const _ray = new THREE.Vector3();
const _eye = new THREE.Vector3();

// Shared geometry and materials — one set for all bots, never disposed.
export class Bot {
  constructor(name, team, scene) {
    this.name = name;
    this.team = team;
    this.health = 100;
    this.dead = false;
    this.state = 'patrol';
    this.fireTimer = 0;
    this.losTimer = 0;
    this.hasLOS = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this._wp = -1;
    this.box = { min: new THREE.Vector3(), max: new THREE.Vector3() };
    this.headBox = { min: new THREE.Vector3(), max: new THREE.Vector3() };
    this.onHit = this.takeDamage.bind(this);
    this._build(team);
    scene.add(this.root);
    }

    // Place the bot, wake it, and reset its combat/animation state.
   spawnAt(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = 0;
    this.health = 100;
    this.dead = false;
    this.state = 'patrol';
    this.fireTimer = 0;
    this.losTimer = 0;
    this.hasLOS = false;
    this._wp = -1;
    this.pickTarget();
    this.ragdoll = null;
    resetPose(this.parts);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
    this._syncMesh();
    }

  update(dt, player, colliders) {
    if (this.dead) return;
    this._detect(player, colliders, dt);
    if (this.state === 'engage') this._engage(dt, player);
    else this._patrol(dt, colliders);
    this._syncMesh();
    }

     // See the player? alive, in range, and an unobstructed eye-to-eye ray.
  _detect(player, colliders, dt) {
    if (player.state.alive && this._lineOfSight(player, colliders)) {
      this.hasLOS = true;
      this.losTimer = 0;
      this.state = 'engage';
       } else {
      this.hasLOS = false;
      this.losTimer += dt;
      if (this.losTimer > LOSE_LOS) this.state = 'patrol';
       }
    }

  _lineOfSight(player, colliders) {
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    if (Math.hypot(dx, dz) > ENGAGE_DIST) return false;
     _eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
     _ray.set(dx, (player.pos.y + player.eye) - (this.pos.y + EYE), dz);
    const len = _ray.length();
     _ray.normalize();
    for (const c of colliders) {
      if (rayAABB(_eye, _ray, c.min, c.max, len) !== null) return false;
      }
    return true;
    }

     // Face the player and fire on cadence; during the LOS grace period hold
     // facing but do not fire.
  _engage(dt, player) {
    if (!this.hasLOS) return;
    this._face(player.pos.x, player.pos.z);
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = FIRE_RATE;
      if (Math.random() > MISS) player.state.takeDamage(BOT_DAMAGE, false, null, this.name);
      }
    }

     // Walk toward the current waypoint, sliding off walls like the player.
  _patrol(dt, colliders) {
    if (this._wp < 0) this.pickTarget();
    const wp = waypoints[this._wp];
     _move.set(wp[0] - this.pos.x, 0, wp[1] - this.pos.z);
    const dist = _move.length();
    if (dist < REACH) {
      this.pickTarget();
      return;
      }
     _move.x /= dist;
     _move.z /= dist;
    this.pos.x += _move.x * SPEED * dt;
    this.pos.z += _move.z * SPEED * dt;
    resolveCapsuleVsBoxes(this.pos, RADIUS, HEIGHT, colliders, { vy: 0 });
    this.pos.y = 0; // bots stay on the floor in P0
    this._face(wp[0], wp[1]);
    }

  pickTarget() {
    this._wp = Math.floor(Math.random() * waypoints.length);
    }

    // Turn so the bot's forward (-Z) points at (x, z).
  _face(x, z) {
    this.yaw = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    }

  takeDamage(amount, headshot, weapon) {
    if (this.dead) return;
    this.health -= amount;
    events.emit('hit', { target: this, damage: amount, headshot });
    if (this.health <= 0) this._die(weapon, headshot);
    }

  _die(weapon, headshot) {
    this.dead = true;
    this.state = 'dead';
    // Hand the figure to a ragdoll. It seeds joint positions from the root's world
    // transform, so the root must be reset to identity afterwards — the limbs are
    // posed in world space from here on.
    this.ragdoll = new Ragdoll(this.parts, this.root);
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    // The bot was facing the shooter, so the killing shot pushes it backwards.
    _move.set(Math.sin(this.yaw), 0.15, Math.cos(this.yaw)).normalize();
    this.ragdoll.impulse(_move, 3.5, headshot);
    events.emit('kill', { killer: 'player', victim: this.name, weapon, headshot });
    }

    // Dead bots keep simulating their ragdoll until it settles. Called every frame
    // by BotManager.updateDead, regardless of round state.
  updateDead(dt, colliders) {
    if (this.dead && this.ragdoll) this.ragdoll.update(dt, colliders);
    }

   // Body + head boxes in the team color, with a small dark nose to show facing.
  _build(team) {
    const { root, parts } = buildHumanoid(TEAM_COLOR[this.team] || 0x888888);
    this.root = root;
    this.parts = parts;
    this.ragdoll = null;
    }

     // Push the bot's transform to its mesh and refresh the hittable boxes.
  _syncMesh() {
    this.root.position.set(this.pos.x, 0, this.pos.z);
    this.root.rotation.y = this.yaw;
    this.box.min.set(this.pos.x - BODY / 2, 0, this.pos.z - BODY / 2);
    this.box.max.set(this.pos.x + BODY / 2, HEIGHT, this.pos.z + BODY / 2);
    this.headBox.min.set(this.pos.x - 0.2, HEIGHT, this.pos.z - 0.2);
    this.headBox.max.set(this.pos.x + 0.2, HEIGHT + 0.4, this.pos.z + 0.2);
    }
}
