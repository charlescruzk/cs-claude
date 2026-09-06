import * as THREE from 'three';
import { resolveCapsuleVsBoxes } from '../core/physics.js';

// Movement is tuned to feel like 1.6. Jump is 7.2 m/s (peak ~1.3 m under gravity 20):
// high enough to clear a 1 m crate, short of a 2 m wall — that is the P0-4 target.
// (The architecture note's 4.8 gives only a ~0.58 m peak and cannot reach a 1 m crate.)
const RUN = 6.5;
const WALK = 3.5;
const CROUCH = 2.5;
const JUMP = 7.2;
const GRAVITY = 20;
const RADIUS = 0.4;
const STAND_H = 1.8;
const CROUCH_H = 1.2;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.0;
const SENS = 0.0025;
const PITCH_LIMIT = 89 * Math.PI / 180;

// The player owns a yaw Object3D (heading) with the camera as a child (pitch).
// Position is the feet; the camera sits at eye height above the feet.
export class PlayerController {
  constructor(camera, input, colliders, spawn) {
    this.camera = camera;
    this.input = input;
    this.colliders = colliders;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.grounded = true;
    this.crouching = false;
    this.height = STAND_H;
    this.eye = STAND_EYE;
    this.yaw = 0;
    this.pitch = 0;
    this.recoil = 0; // view kick added to pitch; the viewmodel eases it back
    this.frozen = false; // set by the round loop during freeze
    this.disabled = false; // set when the player dies
    this.moveScale = 1; // 0.5 while scoped, 1 otherwise (set by main.js)

    this.yawObject = new THREE.Object3D();
    this.yawObject.add(this.camera);
    this.spawnAt(spawn);
    this.syncCamera();
    }

  spawnAt(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.crouching = false;
    this.height = STAND_H;
    this.eye = STAND_EYE;
    }

  update(dt, input, colliders) {
    this.input = input;
    this.colliders = colliders;

    if (!this.disabled) {
      this.look();
      if (this.frozen) {
        this.vel.x = 0;
        this.vel.z = 0;
        } else {
        this.horizontal();
        }
      this.vertical(dt);
     }

    this.syncCamera();
    }

    // Yaw on the parent, pitch on the camera, pitch clamped to ±89°.
  look() {
    this.yaw -= this.input.mouseDX * SENS;
    this.pitch -= this.input.mouseDY * SENS;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    }

    // WASD relative to heading, normalized diagonal, speed by mode. Also jumps.
  horizontal() {
    const keys = this.input.keys;
    let fwd = 0;
    let strafe = 0;
    if (keys.has('KeyW')) fwd += 1;
    if (keys.has('KeyS')) fwd -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;

    this.crouching = keys.has('ControlLeft') || keys.has('ControlRight');
    let speed = RUN;
    if (this.crouching) speed = CROUCH;
    else if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed = WALK;
    speed *= this.moveScale; // scoped aim slows the player to a half-pace

    // At yaw 0, forward is -Z and right is +X. Rotate those by the current yaw.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let dx = fwd * -sin + strafe * cos;
    let dz = fwd * -cos + strafe * -sin;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
     }
    this.vel.x = dx * speed;
    this.vel.z = dz * speed;

    if (this.input.justPressed('Space') && this.grounded) {
      this.vel.y = JUMP;
      this.grounded = false;
     }
    }

    // Gravity, integrate all axes, resolve per axis, then the floor at y = 0.
  vertical(dt) {
    this.vel.y -= GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    let grounded = resolveCapsuleVsBoxes(this.pos, RADIUS, this.height, this.colliders, { vy: this.vel.y });
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      if (this.vel.y < 0) this.vel.y = 0;
      grounded = true;
     }
    this.grounded = grounded;

     // Crouch lowers the capsule height and the eye.
    this.height = this.crouching ? CROUCH_H : STAND_H;
    this.eye = this.crouching ? CROUCH_EYE : STAND_EYE;
    }

    // Place the rig: yaw object at the feet, camera at eye height, pitch on the camera.
  syncCamera() {
    this.yawObject.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.yawObject.rotation.y = this.yaw;
    this.camera.position.set(0, this.eye, 0);
    this.camera.rotation.x = this.pitch + this.recoil;
    }
}
