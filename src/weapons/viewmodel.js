import * as THREE from 'three';
import { events } from '../core/events.js';

// A first-person gun: two boxes parented to the camera at the lower right, with a
// muzzle flash and a recoil kick. On every 'shot' it kicks the gun back/up, shows
// the flash for 40 ms, and pitches the view up by the weapon's recoil — which it
// then recovers (half-life 0.2 s) by easing controller.recoil back to zero.
const FLASH_TIME = 0.04;
const RECOVER = 0.2;

export class Viewmodel {
  constructor(camera, controller) {
    this.camera = camera;
    this.controller = controller;
    this.kick = 0;
    this.flashTimer = 0;
    this._build(camera);
    events.on('shot', this._onShot.bind(this));
   }

   // Two dark boxes read as a gun; the flash is a small emissive sphere at the
   // muzzle, hidden until a shot. The whole rig sits low and to the right.
  _build(camera) {
    this.gun = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x222228 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.5), mat);
    body.position.set(0, 0, -0.25);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.34), mat);
    barrel.position.set(0, 0.03, -0.55);
    this.gun.add(body, barrel);
    this.gun.position.set(0.32, -0.28, -0.55);
    this.gunBase = this.gun.position.clone();

    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc55 })
     );
    this.flash.position.set(0, 0.03, -0.75);
    this.flash.visible = false;
    this.gun.add(this.flash);

     camera.add(this.gun);
   }

   // A shot: kick the gun, light the flash, and add view recoil (pitch up).
  _onShot(payload) {
    this.kick = 0.12;
    this.flashTimer = FLASH_TIME;
    this.controller.recoil += payload.weapon.recoil;
   }

   update(dt) {
       // Recoil recovers on a 0.2 s half-life; snap to zero once negligible.
    this.controller.recoil *= Math.pow(0.5, dt / RECOVER);
    if (Math.abs(this.controller.recoil) < 1e-4) this.controller.recoil = 0;

       // Gun slides back toward rest quickly.
    this.kick *= Math.pow(0.02, dt);
    if (this.kick < 0.002) this.kick = 0;
    this.gun.position.z = this.gunBase.z + this.kick;
    this.gun.position.y = this.gunBase.y + this.kick * 0.5;

       // Muzzle flash on for its window.
    this.flashTimer -= dt;
    this.flash.visible = this.flashTimer > 0;
   }
}
