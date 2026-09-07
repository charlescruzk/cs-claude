import { events } from '../core/events.js';

// Damage direction: a curved red wedge at the screen edge points at whoever
// just hurt the player. The bearing is the attacker's world position relative
// to the player's heading, so the wedge always sits on the correct side of the
// screen no matter which way the player is facing. Wedges are pooled and reused
// — a fresh hit from roughly the same bearing refreshes the existing wedge
// rather than stacking a second one. Driven by update(dt) from the frame loop;
// a second timebase (setTimeout) would drift against it.

const STYLE_ID = 'damage-direction-style';
const DURATION = 1.2;            // s — fade-out time
const COLOR = 'rgba(255, 60, 60, 0.9)';
const POOL = 4;                  // max simultaneous wedges
const MERGE_ANGLE = Math.PI / 6; // rad — hits within 30° refresh the same wedge
const RADIUS_FRACTION = 0.35;    // wedge sits 35% of the way centre → edge
const WEDGE = 40;                // px — wedge box size
const THICK = 8;                 // px — arc thickness (border width)

const CSS = `
#damage-direction { position: fixed; inset: 0; pointer-events: none; z-index: 6; }
#damage-direction .dd-wedge { position: absolute; width: ${WEDGE}px; height: ${WEDGE}px;
  border-radius: 50%; border: ${THICK}px solid transparent; border-top-color: ${COLOR}; }
`;

// Wrap an angle to [-PI, PI]. The modulo form is O(1) and allocation-free.
const wrapPi = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

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
    // Four wedges, built once and reused forever. Only display, opacity, left,
    // top and transform change afterwards — never rebuilt per hit.
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dd-wedge';
      el.style.display = 'none';
      root.appendChild(el);
      this._pool.push({ el, life: 0, angle: 0 });
    }
    document.body.appendChild(root);
    this.root = root;
  }

  _onHit(p) {
    // Only the player being hurt shows a wedge. A hit without a snapshotted
    // attacker position has no direction to point — showing nothing is safer
    // than pointing the player into a wall.
    if (!p || p.target !== 'player') return;
    if (p.fromX == null || p.fromZ == null) return;
    const c = this._c;
    const angle = wrapPi(Math.atan2(p.fromX - c.pos.x, p.fromZ - c.pos.z) - c.yaw);
    // A fresh hit from roughly the same bearing refreshes the existing wedge
    // (restart its timer, move it) rather than stacking a second one.
    for (const w of this._active) {
      if (Math.abs(wrapPi(angle - w.angle)) < MERGE_ANGLE) {
        this._place(w, angle);
        return;
      }
    }
    // No merge: take a free wedge, or recycle the oldest (smallest life).
    let w = this._pool.find((x) => x.life <= 0);
    if (w) {
      this._active.push(w);
    } else {
      w = this._active.reduce((a, b) => (b.life < a.life ? b : a));
    }
    this._place(w, angle);
  }

  // Position a wedge at the bearing and restart its timer.
  _place(w, angle) {
    w.angle = angle;
    w.life = DURATION;
    const r = RADIUS_FRACTION * Math.min(window.innerWidth, window.innerHeight) / 2;
    const x = window.innerWidth / 2 + Math.sin(angle) * r;
    const y = window.innerHeight / 2 + Math.cos(angle) * r;
    const el = w.el;
    el.style.display = 'block';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    // The arc bulges up unrotated; rotate it so it points outward along the
    // bearing. angle π (ahead) → rotation 0 (up), angle 0 (behind) → π (down).
    el.style.transform = `translate(-50%, -50%) rotate(${Math.PI - angle}rad)`;
    el.style.opacity = (w.life / DURATION).toFixed(3);
  }

  // Reset every wedge — the ones still pooled AND the ones in use. A wedge taken
  // into _active left the pool, so resetting only the pool would leave active
  // wedges visible on screen after a round reset, and the pool empty for the
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
        this._pool.push(w); // return the wedge so the free-wedge path stays live
      } else {
        w.el.style.opacity = (w.life / DURATION).toFixed(3);
      }
    }
  }
}
