import { events } from '../core/events.js';

// Hit feedback: four short diagonal ticks around the crosshair, shown briefly
// when a shot connects. Body hits are white, headshots amber and larger, kills
// red and larger still. The marker is built once and only its visibility,
// colour and size change afterwards — never rebuilt per hit. A retrigger while
// visible restarts the timer rather than queueing, so rapid fire gives a steady
// pulse instead of a stuck marker. Driven by update(dt) from the frame loop; a
// second timebase (setTimeout) would drift against it.

const STYLE_ID = 'hitmarker-style';
const GAP = 7;        // px — tick distance from the crosshair centre
const THICK = 2;      // px — tick thickness
const BODY_LEN = 7;   // px — body-shot tick length
const HEAD_LEN = 9;   // px — headshot ticks are a little longer
const KILL_LEN = 11;  // px — kill ticks are longer still
const BODY_T = 0.11;  // s — body-shot duration
const HEAD_T = 0.15;  // s — headshot duration
const KILL_T = 0.22;  // s — kill duration
const BODY_COLOR = '#ffffff';
const HEAD_COLOR = '#ffcc33';
const KILL_COLOR = '#ff5544';

const CSS = `
#hitmarker { position: fixed; inset: 0; pointer-events: none; z-index: 6; }
#hitmarker .hm-tick { position: absolute; left: 50%; top: 50%;
                     box-shadow: 0 0 1px #000; }
`;

export class Hitmarker {
  constructor() {
    this._timer = 0;   // seconds left visible; 0 = hidden
    this._state = 'body';
    this._injectStyle();
    this._build();
    events.on('hit', (p) => this._onHit(p));
    events.on('kill', (p) => this._onKill(p));
    // A new round starts with a clean marker. The timer would clear it within
    // 0.22 s anyway, but resetting on the transition makes it explicit.
    events.on('roundState', (p) => { if (p && p.state === 'freeze') this._hide(); });
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
    root.id = 'hitmarker';
    root.style.display = 'none';
    this._ticks = [];
    // Four bars, one per diagonal, rotated to point at the centre. The transform
    // depends only on the constant gap, so it is set once here; only size and
    // colour change per state.
    for (let i = 0; i < 4; i++) {
      const tick = document.createElement('div');
      tick.className = 'hm-tick';
      const deg = i * 90 + 45;
      const rad = deg * Math.PI / 180;
      const cx = Math.cos(rad) * GAP;
      const cy = Math.sin(rad) * GAP;
      tick.style.transform =
        `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px)) rotate(${deg}deg)`;
      root.appendChild(tick);
      this._ticks.push(tick);
    }
    document.body.appendChild(root);
    this.root = root;
    this._setState('body');
  }

  // Apply a state's size and colour to all four ticks.
  _setState(state) {
    const len = state === 'kill' ? KILL_LEN : state === 'head' ? HEAD_LEN : BODY_LEN;
    const color = state === 'kill' ? KILL_COLOR : state === 'head' ? HEAD_COLOR : BODY_COLOR;
    for (const t of this._ticks) {
      t.style.width = len + 'px';
      t.style.height = THICK + 'px';
      t.style.backgroundColor = color;
    }
  }

  _onHit(p) {
    // Only the player's own landed shots show a marker. A 'hit' whose target is
    // the player means the player was hurt — that is the red vignette's job.
    if (!p || p.target === 'player') return;
    // A kill already showing is the stronger signal; nothing overrides it.
    if (this._state === 'kill') return;
    const head = !!(p && p.headshot);
    // A headshot beats a body shot: if a headshot is showing, a body hit does
    // not downgrade it.
    if (head) {
      this._state = 'head';
      this._timer = HEAD_T;
    } else if (this._state !== 'head') {
      this._state = 'body';
      this._timer = BODY_T;
    }
    this._setState(this._state);
    this.root.style.display = 'block';
  }

  _onKill(p) {
    if (!p || p.killer !== 'player') return;
    this._state = 'kill';
    this._timer = KILL_T;
    this._setState('kill');
    this.root.style.display = 'block';
  }

  _hide() {
    this._timer = 0;
    this._state = 'body';
    this.root.style.display = 'none';
  }

  update(dt) {
    if (this._timer <= 0) return;
    this._timer -= dt;
    if (this._timer <= 0) this._hide();
  }
}
