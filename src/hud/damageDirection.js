import { events } from '../core/events.js';

// Damage direction: a soft red glow bleeds in from the screen edge on the side
// whoever just hurt the player is standing. The bearing is the attacker's world
// position relative to the player's heading, so the glow always sits on the
// correct side of the screen no matter which way the player is facing. Each
// glow is a full-viewport element carrying a top-anchored gradient, rotated
// about the centre by the bearing — a hit costs one transform write. Glows are
// pooled and reused; a fresh hit from roughly the same bearing refreshes the
// existing one rather than stacking a second. Driven by update(dt) from the
// frame loop; a second timebase (setTimeout) would drift against it.

const STYLE_ID = 'damage-direction-style';
const DURATION = 1.2;            // s — fade-out time
const POOL = 4;                  // max simultaneous glows
const MERGE_ANGLE = Math.PI / 6; // rad — hits within 30° refresh the same glow
const COMBINED_CAP = 0.6;        // max summed opacity of all live glows
const DMG_SCALE_MIN = 0.45;      // element opacity scale at DMG_SCALE_AT damage
const DMG_SCALE_AT = 10;         // damage that maps to DMG_SCALE_MIN
const DMG_SCALE_MAX = 1.0;       // element opacity scale at DMG_SCALE_FULL+ damage
const DMG_SCALE_FULL = 50;       // damage that maps to DMG_SCALE_MAX

const CSS = `
#damage-direction { position: fixed; inset: 0; pointer-events: none; z-index: 6; }
#damage-direction .dd-wedge { position: absolute; left: 50%; top: 50%;
  width: 200vmax; height: 200vmax; pointer-events: none;
  background: radial-gradient(ellipse 60% 22% at 50% 0%,
    rgba(255,40,40,0.55) 0%, rgba(255,30,30,0.22) 30%, rgba(255,0,0,0) 50%); }
`;

// Wrap an angle to [-PI, PI]. The modulo form is O(1) and allocation-free.
const wrapPi = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

// Map a hit's damage to the element's peak opacity: 10 → 0.45, 50+ → 1.0 of the
// element's own maximum, so a pistol tap and a burst read differently.
const scaleFor = (damage) => Math.min(1, DMG_SCALE_MIN +
  (damage - DMG_SCALE_AT) * (DMG_SCALE_MAX - DMG_SCALE_MIN) / (DMG_SCALE_FULL - DMG_SCALE_AT));

export class DamageDirection {
  constructor(controller) {
    this._c = controller;
    this._active = []; // wedges currently visible
    this._pool = [];
    this._injectStyle();
    this._build();
    events.on('hit', (p) => this._onHit(p));
    // A new round starts with a clean screen; leftover wedges would point at
    // ghosts from the previous round.
    events.on('roundState', (p) => { if (p && p.state === 'freeze') this._clear(); });
  }

  _injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'damage-direction';
    // Four glows, built once and reused forever. Only display, opacity and
    // transform change afterwards — never rebuilt per hit.
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dd-wedge';
      el.style.display = 'none';
      root.appendChild(el);
      this._pool.push({ el, life: 0, angle: 0, scale: 0 });
    }
    document.body.appendChild(root);
    this.root = root;
  }

  _onHit(p) {
    // Only the player being hurt shows a glow. A hit without a snapshotted
    // attacker position has no direction to point — showing nothing is safer
    // than pointing the player into a wall.
    if (!p || p.target !== 'player') return;
    if (p.fromX == null || p.fromZ == null) return;
    const c = this._c;
    const angle = wrapPi(Math.atan2(p.fromX - c.pos.x, p.fromZ - c.pos.z) - c.yaw);
    const s = scaleFor(p.damage || 0);
    // A fresh hit from roughly the same bearing refreshes the existing glow
    // (restart its timer, move it) rather than stacking a second one. The
    // brightness keeps the stronger of the two hits.
    for (const w of this._active) {
      if (Math.abs(wrapPi(angle - w.angle)) < MERGE_ANGLE) {
        w.scale = Math.max(w.scale, s);
        this._place(w, angle);
        return;
      }
    }
    // No merge: take a free glow, or recycle the oldest (smallest life).
    let w = this._pool.find((x) => x.life <= 0);
    if (w) {
      w.scale = s;
      this._active.push(w);
    } else {
      w = this._active.reduce((a, b) => (b.life < a.life ? b : a));
      w.scale = s;
    }
    this._place(w, angle);
  }

  // Point a glow at the bearing and restart its timer. The element is a
  // full-viewport square centred on the screen; rotating it about the centre
  // moves the top-anchored gradient around the border. angle π (ahead) →
  // rotation 0 (glow at top), angle 0 (behind) → π (glow at bottom).
  _place(w, angle) {
    w.angle = angle;
    w.life = DURATION;
    w.el.style.display = 'block';
    w.el.style.transform = `translate(-50%, -50%) rotate(${Math.PI - angle}rad)`;
    this._rebalance();
  }

  // Recompute every active glow's opacity. Each glow's own brightness is its
  // damage scale × its fade; the COMBINED cap only clamps when two or more
  // directions are live, so a lone hit keeps its full damage-scaled brightness.
  _rebalance() {
    if (this._active.length === 0) return;
    let sum = 0;
    for (const w of this._active) sum += w.scale * (w.life / DURATION);
    const cap = this._active.length > 1 && sum > COMBINED_CAP ? COMBINED_CAP / sum : 1;
    for (const w of this._active) {
      w.el.style.opacity = (w.scale * (w.life / DURATION) * cap).toFixed(3);
    }
  }

  // Reset every glow — the ones still pooled AND the ones in use. A glow taken
  // into _active left the pool, so resetting only the pool would leave active
  // glows visible on screen after a round reset, and the pool empty for the
  // next hit (which would then reduce() an empty _active and crash).
  _clear() {
    for (const w of this._pool) {
      w.life = 0;
      w.el.style.display = 'none';
    }
    for (const w of this._active) {
      w.life = 0;
      w.el.style.display = 'none';
      this._pool.push(w);
    }
    this._active.length = 0;
  }

  update(dt) {
    if (this._active.length === 0) return;
    for (let i = this._active.length - 1; i >= 0; i--) {
      const w = this._active[i];
      w.life -= dt;
      if (w.life <= 0) {
        w.el.style.display = 'none';
        this._active.splice(i, 1);
        this._pool.push(w); // return the glow so the free-glow path stays live
      }
    }
    this._rebalance();
  }
}
