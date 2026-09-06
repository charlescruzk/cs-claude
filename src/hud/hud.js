import { events } from '../core/events.js';

// Crosshair mapping: a weapon spread of a few-thousandths of a radian opens the
// four crosshair bars out to a few–dozen pixels. `CH_REF` is the spread value
// that reaches the widest gap; larger spreads clamp there.
const CH_MIN = 4;      // gap at zero spread (px)
const CH_MAX = 46;     // gap at full spread (px)
const CH_REF = 0.05;   // spread that reaches CH_MAX
const FEED_MAX = 5;    // kill-feed lines kept on screen
const FEED_TTL = 5;    // seconds a line stays solid before it fades
const VIGNETTE_TTL = 0.35; // how long the red flash eases out

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

// The on-screen HUD. `update(dt, state)` reads live values each frame; the
// `hit`/`kill` events drive the damage vignette and the kill feed between
// frames. All elements are built once in index.html and updated in place.
export class Hud {
  constructor() {
    this.cross = document.getElementById('crosshair');
    this.bars = this.cross.querySelectorAll('.ch'); // [up, down, left, right]
    this.timer = document.getElementById('timer');
    this.healthNum = document.getElementById('health-num');
    this.armorNum = document.getElementById('armor-num');
    this.healthBar = document.getElementById('health-bar');
    this.armorBar = document.getElementById('armor-bar');
    this.mag = document.getElementById('mag');
    this.reserve = document.getElementById('reserve');
    this.weaponName = document.getElementById('weapon-name');
    this.killfeed = document.getElementById('killfeed');
    this.vignette = document.getElementById('vignette');
    this.scope = document.getElementById('scope-overlay');
    this._feed = []; // { el, age }
    this._vignette = 0; // 0..1 flash intensity, eased out in update
    this._bindEvents();
   }

   // A 'hit' fires for both the player and bots; only the player flashes red.
  _bindEvents() {
    events.on('hit', (p) => { if (p.target === 'player') this._vignette = 1; });
    events.on('kill', (p) => this._pushKill(p));
   }

  _pushKill(p) {
    const killer = p.killer || '—';
    const victim = p.victim || '—';
    const wpn = p.weapon ? p.weapon.name : '';
    const el = document.createElement('div');
    el.className = 'kf';
    el.textContent = wpn ? `${killer} ▸ ${wpn} ▸ ${victim}` : `${killer} ▸ ${victim}`;
    this.killfeed.appendChild(el);
    this._feed.push({ el, age: 0 });
       // Keep only the last FEED_MAX lines.
    while (this._feed.length > FEED_MAX) this._feed.shift().el.remove();
   }

   // Age every line; fade it at FEED_TTL and drop the node a second later (the
   // CSS opacity transition does the actual fade).
  _ageKills(dt) {
    for (const f of this._feed) f.age += dt;
    for (let i = this._feed.length - 1; i >= 0; i--) {
      const f = this._feed[i];
      if (f.age >= FEED_TTL + 1) {
        f.el.remove();
        this._feed.splice(i, 1);
        } else if (f.age >= FEED_TTL) {
        f.el.style.opacity = '0';
         }
     }
   }

  update(dt, state) {
    const { player, weapon, round, spread, scoped } = state;
    this._ageKills(dt);

    // Red vignette eases out from 1; a fresh player hit resets it to 1.
    if (this._vignette > 0) {
      this._vignette = Math.max(0, this._vignette - dt / VIGNETTE_TTL);
      this.vignette.style.opacity = this._vignette.toFixed(3);
     }

       // Crosshair opens with the current spread.
    this._setCross(CH_MIN + Math.min(1, (spread || 0) / CH_REF) * (CH_MAX - CH_MIN));

       // Status (bottom-left).
    const hp = Math.max(0, Math.round(player.health));
    const ar = Math.max(0, Math.round(player.armor));
    this.healthNum.textContent = hp;
    this.armorNum.textContent = ar;
    this.healthBar.style.width = `${Math.min(100, hp)}%`;
    this.armorBar.style.width = `${Math.min(100, ar)}%`;

       // Ammo + weapon name (bottom-right).
    const a = weapon.current;
    this.mag.textContent = a.mag;
    this.reserve.textContent = a.reserve;
    this.weaponName.textContent = weapon.def.name;

       // Round timer (top-center).
    this.timer.textContent = round ? fmtTime(round.time) : '0:00';

         // Scoped view: show the scope overlay, hide the normal crosshair.
    if (this.scope) this.scope.style.display = scoped ? 'block' : 'none';
    this.cross.style.display = scoped ? 'none' : '';
   }

   // Push the four bars out from center by `gap` px from their center.
  _setCross(gap) {
    const b = this.bars;
    b[0].style.transform = `translate(-50%, calc(-50% - ${gap}px))`; // up
    b[1].style.transform = `translate(-50%, calc(-50% + ${gap}px))`; // down
    b[2].style.transform = `translate(calc(-50% - ${gap}px), -50%)`; // left
    b[3].style.transform = `translate(calc(-50% + ${gap}px), -50%)`; // right
   }
}
