// The settings panel. Lives inside #lock-overlay like the multiplayer panel, so it is
// only reachable on the pause / click-to-play screen — never while the pointer is
// locked. Everything (markup and CSS) is built here; index.html is not touched.
//
// Same two hazards as netMenu.js: a click inside the panel must not reach
// #lock-overlay's requestLock handler, and a keydown must not reach input.js's window
// listener. Only PRESS events are trapped — swallowing mouseup/keyup would leave
// input.js holding a button the player has already released.
//
// Every control applies live on 'input' and persists to one localStorage key. All
// storage access is wrapped in try/catch: localStorage throws on ACCESS in private
// browsing, and an unguarded read at module load would kill the game before it boots.

const STYLE_ID = 'settings-menu-style';
const STORE_KEY = 'cs-browser.settings';

// Defaults. Sensitivity is the controller's SENS (0.0025); the slider shows it as a
// multiplier against that, so "1.0x" means exactly the shipped feel.
const DEFAULTS = {
  sens: 0.0025,
  bob: 1.0,
  volume: 0.6,
  invertY: false,
};

// z-index 7, same as #net-menu. #lock-overlay sets no z-index/transform/opacity so it
// creates no stacking context; this child is positioned in the root context and 7 puts
// it above every existing layer. Bottom-left, so it never overlaps the multiplayer
// panel (bottom-right) or the title.
const CSS = `
#settings-menu { position: fixed; left: 18px; bottom: 18px; z-index: 7;
                width: 240px; cursor: default; text-align: left; }
#settings-menu .sm-body { display: none; }
#settings-menu.open .sm-body { display: block; }
#settings-menu .sm-toggle { width: 100%; padding: 8px 10px; font: 12px/1 monospace;
                            letter-spacing: .12em; text-transform: uppercase; cursor: pointer;
                            background: rgba(0,0,0,.55); color: #a8a59c; border: 1px solid #333; }
#settings-menu .sm-toggle:hover { color: #e8e6e0; }
#settings-menu .sm-hd { font: 700 13px/1 monospace; letter-spacing: .12em;
                        text-transform: uppercase; opacity: .8; margin-bottom: 12px; }
#settings-menu .sm-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
#settings-menu .sm-lbl { width: 88px; font-size: 11px; letter-spacing: .08em;
                         text-transform: uppercase; opacity: .7; }
#settings-menu input[type=range] { flex: 1; min-width: 0; }
#settings-menu .sm-val { width: 44px; text-align: right; font: 11px/1 monospace; opacity: .85; }
#settings-menu .sm-chk { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
#settings-menu .sm-chk input { margin: 0; }
`;

export class SettingsMenu {
  constructor({ controller = null, viewmodel = null, audio = null } = {}) {
    this.controller = controller;
    this.viewmodel = viewmodel;
    this.audio = audio;
    this._injectStyle();
    this._build();
  }

  _injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  _build() {
    const saved = this._load();
    const host = document.getElementById('lock-overlay') || document.body;

    const root = document.createElement('div');
    root.id = 'settings-menu';
    root.innerHTML = `
      <button class="sm-toggle" id="sm-toggle" type="button">Settings &#9656;</button>
      <div class="sm-body">
        <div class="sm-hd">Settings</div>
        <div class="sm-row"><span class="sm-lbl">Sensitivity</span>
          <input id="sm-sens" type="range" min="0.0005" max="0.0080" step="0.0001">
          <span class="sm-val" id="sm-sens-val">1.0x</span></div>
        <div class="sm-row"><span class="sm-lbl">Weapon bob</span>
          <input id="sm-bob" type="range" min="0" max="2.0" step="0.1">
          <span class="sm-val" id="sm-bob-val">1.0</span></div>
        <div class="sm-row"><span class="sm-lbl">Volume</span>
          <input id="sm-vol" type="range" min="0" max="1" step="0.05">
          <span class="sm-val" id="sm-vol-val">60%</span></div>
        <div class="sm-chk"><span class="sm-lbl">Invert Y</span>
          <input id="sm-inv" type="checkbox"></div>
      </div>`;
    host.appendChild(root);

    this.root = root;
    this.sensEl = root.querySelector('#sm-sens');
    this.sensVal = root.querySelector('#sm-sens-val');
    this.bobEl = root.querySelector('#sm-bob');
    this.bobVal = root.querySelector('#sm-bob-val');
    this.volEl = root.querySelector('#sm-vol');
    this.volVal = root.querySelector('#sm-vol-val');
    this.invEl = root.querySelector('#sm-inv');
    this.toggleEl = root.querySelector('#sm-toggle');

    this._trapEvents(root);

    // The toggle owns the 'open' class that shows the body. Its click must stop
    // propagation too: it is a button inside the panel, and a bare click would
    // otherwise reach #lock-overlay's requestLock handler once the panel is open.
    this.toggleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.root.classList.toggle('open');
    });

    // Apply live on input, not behind a save button. The checkbox fires 'change'
    // (and 'input' in modern browsers); both are live, so either path applies.
    this.sensEl.addEventListener('input', () => this._apply());
    this.bobEl.addEventListener('input', () => this._apply());
    this.volEl.addEventListener('input', () => this._apply());
    this.invEl.addEventListener('change', () => this._apply());

    // Load persisted values (validated in _load), then apply them to the live
    // objects so a reload keeps the feel without the player touching anything.
    this.sensEl.value = saved.sens;
    this.bobEl.value = saved.bob;
    this.volEl.value = saved.volume;
    this.invEl.checked = saved.invertY;
    this._apply();
  }

  // Keep every event the panel generates inside the panel. Pointer events would
  // otherwise reach #lock-overlay's requestLock handler; key events would otherwise
  // reach input.js's window listener and be read as game actions.
  _trapEvents(root) {
    // Only PRESS events are trapped. Swallowing 'mouseup'/'keyup' would leave
    // input.js holding a key or mouse button the player has already released — the
    // rifle keeps firing, or the player walks by itself, after resuming.
    for (const type of ['click', 'mousedown', 'pointerdown',
                        'dblclick', 'contextmenu', 'keydown']) {
      root.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  // Push every control into the live objects, refresh the readouts, and persist.
  _apply() {
    const sens = Number(this.sensEl.value);
    const bob = Number(this.bobEl.value);
    const volume = Number(this.volEl.value);
    const invertY = this.invEl.checked;

    if (this.controller) {
      this.controller.sens = sens;
      this.controller.invertY = invertY;
    }
    if (this.viewmodel) this.viewmodel.bobScale = bob; // 0 fully disables the bob
    if (this.audio) this.audio.setVolume(volume);

    this.sensVal.textContent = (sens / 0.0025).toFixed(1) + 'x';
    this.bobVal.textContent = bob.toFixed(1);
    this.volVal.textContent = Math.round(volume * 100) + '%';

    this._save({ sens, bob, volume, invertY });
  }

  // localStorage can throw on ACCESS (private mode, disabled storage); a remembered
  // setting is not worth a crash on the pause screen. Each value is validated to be
  // a finite number in range and falls back to the default otherwise.
  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
      return {
        sens: this._num(raw.sens, DEFAULTS.sens, 0.0005, 0.0080),
        bob: this._num(raw.bob, DEFAULTS.bob, 0, 2.0),
        volume: this._num(raw.volume, DEFAULTS.volume, 0, 1),
        invertY: raw.invertY === true,
      };
    } catch (err) {
      return { ...DEFAULTS };
    }
  }

  _num(v, fallback, min, max) {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }

  _save(values) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(values));
    } catch (err) { /* storage unavailable; the settings simply do not persist */ }
  }
}
