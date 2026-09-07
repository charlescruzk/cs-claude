import * as THREE from 'three';
import { events } from '../core/events.js';
import { getGun } from '../geo/gun.js';

// A first-person gun: two boxes parented to the camera at the lower right, with a
// muzzle flash and a recoil kick. On every 'shot' it kicks the gun back/up, shows
// the flash for 40 ms, and pitches the view up by the weapon's recoil — which it
// then recovers (half-life 0.2 s) by easing controller.recoil back to zero.
const FLASH_TIME = 0.04;
const RECOVER = 0.2;

// Weapon bob. Larger than a camera bob would be — the gun is close to the lens, so
// the same physical motion reads smaller, and the world is not moving with it.
const BOB_X = 0.014;   // m — side to side, at step frequency
const BOB_Y = 0.010;   // m — up and down, at twice step frequency (both feet)
const BOB_ROLL = 0.02; // rad — slight roll into the sway, so it is not a pure slide

export class Viewmodel {
  constructor(camera, controller, weapon) {
    this.camera = camera;
    this.controller = controller;
    this.weapon = weapon;
    this.kick = 0;
    this.flashTimer = 0;
    this._shapeDef = null;
    this._build(camera);
    if (weapon) this._reshape(weapon.def);
    events.on('shot', this._onShot.bind(this));
   }

   // The gun rig sits low and to the right of the camera. The model itself comes
   // from geo/gun.js per weapon and is swapped on change; the flash is a small
   // emissive sphere parked at that model's muzzle.
  _build(camera) {
    this.gun = new THREE.Group();
    this.model = null;
    this.gun.position.set(0.32, -0.28, -0.55);
    this.gunBase = this.gun.position.clone();

    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc55 })
     );
    this.flash.visible = false;
    this.gun.add(this.flash);

     camera.add(this.gun);
   }

   // Swap in the equipped weapon's cached model and park the flash at its muzzle.
  _reshape(def) {
    const { group, muzzleZ } = getGun(String(def.name || 'rifle').toLowerCase());
    if (this.model) this.gun.remove(this.model);
    this.model = group;
    this.gun.add(group);
    this.flash.position.set(0, 0.015, muzzleZ - 0.03);
    this._shapeDef = def;
   }

   // A shot: kick the gun, light the flash, and add view recoil (pitch up).
  _onShot(payload) {
    this.kick = 0.12;
    this.flashTimer = FLASH_TIME;
    this.controller.recoil += payload.weapon.recoil;
   }

   update(dt) {
    if (this.weapon && this.weapon.def !== this._shapeDef) this._reshape(this.weapon.def);
    this.gun.visible = !(this.weapon && this.weapon.scoped); // hide the gun while scoped

       // Recoil recovers on a 0.2 s half-life; snap to zero once negligible.
    this.controller.recoil *= Math.pow(0.5, dt / RECOVER);
    if (Math.abs(this.controller.recoil) < 1e-4) this.controller.recoil = 0;

       // Gun slides back toward rest quickly.
    this.kick *= Math.pow(0.02, dt);
    if (this.kick < 0.002) this.kick = 0;

       // Weapon bob, driven by the controller's step phase so the gun, the footstep
       // sounds and the player's stride all agree. The camera never moves — that is
       // the entire point: the world stays readable while the weapon shows the walk.
    const amp = this.controller.bobAmp || 0;
    const phase = this.controller.bobPhase || 0;
    const bx = Math.sin(phase) * BOB_X * amp;
    const by = Math.sin(phase * 2) * BOB_Y * amp;
    this.gun.position.x = this.gunBase.x + bx;
    this.gun.position.y = this.gunBase.y + this.kick * 0.5 + by;
    this.gun.position.z = this.gunBase.z + this.kick;
    this.gun.rotation.z = -bx * (BOB_ROLL / BOB_X);

       // Muzzle flash on for its window.
    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
   }
}
