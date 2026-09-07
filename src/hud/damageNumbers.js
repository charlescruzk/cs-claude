import * as THREE from 'three';
import { events } from '../core/events.js';

// Damage feedback: a number floats up off the enemy you just shot, summing the
// damage of rapid hits on the same target so a shotgun pull reads as one number
// instead of eight. Body shots are white, headshots amber and larger. Numbers
// are built once and pooled — only text, position, opacity and colour change
// afterwards, never rebuilt per hit. Driven by update(dt) from the frame loop;
// a second timebase (setTimeout) would drift against it.

const STYLE_ID = 'damage-numbers-style';
const LIFE = 0.9;          // s — how long a number stays up
const MERGE_WINDOW = 0.15; // s — hits on the same target within this merge
const FLOAT = 40;          // px — total upward drift over the lifetime
const CAP = 12;            // max simultaneous numbers; oldest recycled beyond this
const CHEST_H = 1.2;       // m — height above the feet to project from
const BODY_SIZE = 16;      // px — body-shot font size
const HEAD_SIZE = 20;      // px — headshot font size
const BODY_COLOR = '#ffffff';
const HEAD_COLOR = '#ffcc33';

const CSS = `
#damage-numbers { position: fixed; inset: 0; pointer-events: none; z-index: 6; }
#damage-numbers .dn-num { position: absolute; left: 0; top: 0; font-weight: bold;
                         text-shadow: 0 0 2px #000; }
`;

// Scratch vector for the per-hit projection, reused (no per-hit alloc).
const _proj = new THREE.Vector3();

export class DamageNumbers {
  constructor(camera) {
    this._camera = camera;
    this._active = [];   // live entries: { el, target, life, x, y, damage, head }
    this._pool = [];     // hidden number divs ready for reuse
    this._injectStyle();
    this._build();
    events.on('hit', (p) => this._onHit(p));
    // A new round starts with a clean field. The numbers would fade within
    // 0.9 s anyway, but resetting on the transition makes it explicit.
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
    root.id = 'damage-numbers';
    // All numbers are pooled up front; a hit only reuses an element, never
    // creates one.
    for (let i = 0; i < CAP; i++) {
      const el = document.createElement('div');
      el.className = 'dn-num';
      el.style.display = 'none';
      root.appendChild(el);
      this._pool.push(el);
    }
    document.body.appendChild(root);
    this.root = root;
  }

  _onHit(p) {
    // Only the player's own landed shots show a number. A 'hit' whose target is
    // the player means the player was hurt — that is the red vignette's job.
    if (!p || p.target === 'player') return;
    const t = p.target;
    if (!t || !t.pos) return;
    // Project the target's chest to screen space. NDC z > 1 means the point is
    // behind the camera — never place a number for an enemy you cannot see.
    _proj.set(t.pos.x, t.pos.y + CHEST_H, t.pos.z);
    this._camera.project(_proj);
    if (_proj.z > 1) return;
    const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
    const dmg = p.damage || 0;
    // A fresh hit on the same target within the merge window accumulates into
    // the existing number instead of spawning another — a shotgun pull is 8
    // pellets, and 8 numbers on one enemy is noise.
    for (const e of this._active) {
      if (e.target === t && e.life > LIFE - MERGE_WINDOW) {
        e.damage += dmg;
        e.life = LIFE;
        e.x = x;
        e.y = y;
        e.head = e.head || !!p.headshot;
        this._paint(e);
        return;
      }
    }
    const entry = { el: this._takeEl(), target: t, life: LIFE, x, y, damage: dmg, head: !!p.headshot };
    this._active.push(entry);
    this._paint(entry);
  }

  // Grab a pooled element, recycling the oldest active number if the pool is
  // empty (the cap is a hard limit, not a queue). The recycled element is
  // stolen directly — it must NOT go back into the pool, or the pool would hold
  // an element that is already in use and the next take would double-book it.
  _takeEl() {
    if (this._pool.length > 0) return this._pool.pop();
    let oldest = this._active[0];
    for (const e of this._active) if (e.life < oldest.life) oldest = e;
    this._active.splice(this._active.indexOf(oldest), 1);
    return oldest.el;
  }

  // Push an entry's current state onto its element.
  _paint(e) {
    e.el.textContent = String(e.damage);
    e.el.style.fontSize = (e.head ? HEAD_SIZE : BODY_SIZE) + 'px';
    e.el.style.color = e.head ? HEAD_COLOR : BODY_COLOR;
    e.el.style.display = 'block';
    e.el.style.opacity = (e.life / LIFE).toFixed(3);
    e.el.style.transform = `translate(${e.x}px, ${e.y}px) translate(-50%, -50%)`;
  }

  _clear() {
    for (const e of this._active) {
      e.el.style.display = 'none';
      this._pool.push(e.el);
    }
    this._active.length = 0;
  }

  update(dt) {
    if (this._active.length === 0) return;
    const rise = (FLOAT / LIFE) * dt;
    // Iterate backwards so expiring entries can be spliced out in place.
    for (let i = this._active.length - 1; i >= 0; i--) {
      const e = this._active[i];
      e.life -= dt;
      e.y -= rise; // screen y grows downward, so up is negative
      e.el.style.opacity = (e.life / LIFE).toFixed(3);
      e.el.style.transform = `translate(${e.x}px, ${e.y}px) translate(-50%, -50%)`;
      if (e.life <= 0) {
        e.el.style.display = 'none';
        this._pool.push(e.el);
        this._active.splice(i, 1);
      }
    }
  }
}
