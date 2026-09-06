import * as THREE from 'three';
import { events } from '../core/events.js';
import { weaponData, WEAPON_KEYS } from './weaponData.js';

// 0.5 s draw time between weapon switches, during which firing is blocked.
const DRAW_TIME = 0.5;

// Scratch vectors reused per frame. The shot event receives clones so a listener
// (hitscan) can keep the origin/direction without racing the next fire.
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perturb = new THREE.Vector3();
const _tmp = new THREE.Vector3();

// The player's whole weapon system. Holds one ammo set per weapon and switches
// between them on keys 1-4. A single update(dt, input, camera) drives switching,
// reloads, fire cadence (semi vs auto), growing spread, and emits one 'shot' per
// pull carrying the origin, a spread-perturbed direction per pellet, and the
// current weapon def (main.js fans the pellets out into hitscans).
export class Weapon {
  constructor(startKey = 'pistol') {
    this.defs = WEAPON_KEYS.map((k) => weaponData[k]);
    this.index = Math.max(0, WEAPON_KEYS.indexOf(startKey));
    this.ammo = this.defs.map((d) => ({ mag: d.mag, reserve: d.reserve }));
    this.fireCooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.switching = false;
    this.switchTimer = 0;
    this.prevTrigger = false;
    this._releaseTimer = 0;
    this.spread = this.defs[this.index].spread;
    this.scoped = false; // true only while RMB is held on the scoped (sniper) weapon
  }

  get def() { return this.defs[this.index]; }
  get current() { return this.ammo[this.index]; }
  get currentSpread() { return this.spread; }
  get isBusy() { return this.switching || this.reloading; }

   // Top every weapon back to a full mag and reserve and clear any in-progress
   // reload — the round loop calls this on reset so each round starts loaded.
  refill() {
    this.defs.forEach((d, i) => {
      this.ammo[i].mag = d.mag;
      this.ammo[i].reserve = d.reserve;
      });
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.spread = this.defs[this.index].spread;
    }

  update(dt, input, camera) {
    this._switch(input);
    this._reloadInput(input);
    this._updateSpread(dt, input);
    this._scope(input);
    this._fire(input, camera);
    this._advance(dt);
  }

    // Keys 1-4 change the weapon, start the draw-time block, and drop any reload.
  _switch(input) {
    if (this.switching) return;
    let idx = -1;
    for (let i = 0; i < WEAPON_KEYS.length; i++) {
      if (input.justPressed('Digit' + (i + 1))) { idx = i; break; }
      }
    if (idx >= 0 && idx !== this.index) {
      this.index = idx;
      this.switching = true;
      this.switchTimer = DRAW_TIME;
      this.reloading = false;
      this.reloadTimer = 0;
      this.spread = this.defs[idx].spread;
      this.prevTrigger = false; // a held trigger must not fire through the switch
    }
  }

    // R reloads manually; an empty mag with the trigger held auto-reloads.
  _reloadInput(input) {
    if (this.switching || this.reloading) return;
    const a = this.current;
    const d = this.def;
    if (a.mag >= d.mag || a.reserve <= 0) return;
    const auto = a.mag === 0 && input.mouseDown[0];
    if (input.justPressed('KeyR') || auto) {
      this.reloading = true;
      this.reloadTimer = d.reloadTime;
    }
  }

  _finishReload() {
    const a = this.current;
    const d = this.def;
    const take = Math.min(d.mag - a.mag, a.reserve);
    a.mag += take;
    a.reserve -= take;
    this.reloading = false;
  }

    // Rifle spread grows per shot (in _fire) and resets to base 0.3s after the
    // trigger is released; the pistol has no growing spread so this is a no-op.
  _updateSpread(dt, input) {
    const d = this.def;
    if (input.mouseDown[0]) {
      this._releaseTimer = 0;
    } else {
      this._releaseTimer += dt;
      if (this._releaseTimer >= (d.spreadRecover || 0.3)) this.spread = d.spread;
    }
    if (this.spread < d.spread) this.spread = d.spread;
  }

    // Scope: while RMB is held on the scoped weapon, spread forces to 0 (dead-on
    // aim). A non-scoped weapon has no scoped flag, so this is a no-op for it.
  _scope(input) {
    this.scoped = !!(this.def.scoped && input.mouseDown[2]);
    if (this.scoped) this.spread = 0;
  }

  _fire(input, camera) {
      // Track the trigger edge every frame so a semi-auto fires once per click
      // and a held trigger does not re-fire the moment a cooldown expires.
    const trigger = input.mouseDown[0];
    const justPressed = trigger && !this.prevTrigger;
    this.prevTrigger = trigger;

    if (this.switching || this.reloading || this.fireCooldown > 0) return;
    const a = this.current;
    const d = this.def;
    if (a.mag <= 0) return; // auto-reload kicks in via _reloadInput next frame

    const doFire = d.auto ? trigger : justPressed;
    if (!doFire) return;

    a.mag -= 1;
    this.fireCooldown = 60 / d.rpm;
    if (d.spreadPerShot) {
      this.spread += d.spreadPerShot;
      this._releaseTimer = 0;
    }

      // Direction is the camera forward nudged by a small random amount, then
      // renormalized — a cheap cone of half-angle ≈ current spread.
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_dir);
    const s = this.spread;
     _perturb
       .copy(_dir)
       .add(
         _tmp.set(
           (Math.random() - 0.5) * 2 * s,
           (Math.random() - 0.5) * 2 * s,
           (Math.random() - 0.5) * 2 * s
         )
       )
       .normalize();
    events.emit('shot', {
      origin: _origin.clone(),
      dir: _perturb.clone(),
      weapon: d,
      pellets: d.pellets || 1,
    });
  }

    // Draw-time and reload/cooldown timers advance here, at the end of the frame.
  _advance(dt) {
    if (this.switching) {
      this.switchTimer -= dt;
      if (this.switchTimer <= 0) this.switching = false;
    }
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this._finishReload();
    }
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
  }
}
