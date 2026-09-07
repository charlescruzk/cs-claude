// The multiplayer join panel. It lives inside #lock-overlay so it is only reachable
// on the pause / click-to-play screen — never while the pointer is locked and the
// player is shooting. Everything (markup and CSS) is built here; index.html is not
// touched.
//
// Two hazards this file exists to defuse:
//  1. #lock-overlay has a click handler calling input.requestLock(). A click anywhere
//     inside the panel would lock the pointer mid-typing, so the panel stops click /
//     mousedown / pointerdown from bubbling out to it.
//  2. src/core/input.js registers a GLOBAL window 'keydown' listener that feeds game
//     actions and preventDefaults Space/Tab/arrows. Typing "ABCD" into the room field
//     would fire weapon switches and jumps. input.js is not owned by this file, so the
//     panel also stops keydown/keyup at its own root: window listeners are bubble-phase,
//     and the panel sits below window on the propagation path, so the event never
//     reaches the game. The proper fix still belongs in input.js — see NOTE at the
//     bottom of this file.

import { normaliseRoom, normaliseName } from '../net/protocol.js';

const STYLE_ID = 'net-menu-style';
const STORE_KEY = 'cs-browser.net';
// Ambiguous glyphs (0/O, 1/I) left out: room codes get read aloud and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// z-index 7. The table in index.html uses 5 (#scope-overlay, #buy-menu) and
// 6 (#whiteout, #impact-flash); #lock-overlay itself is unset. #lock-overlay sets no
// z-index/transform/opacity so it creates no stacking context, which means this child
// is positioned in the root context and 7 puts it above every existing layer.
const CSS = `
#net-menu { position: fixed; left: 50%; top: 50%; z-index: 7;
            transform: translate(-50%, 64px); cursor: default;
            background: rgba(20,22,28,.94); border: 1px solid rgba(255,255,255,.12);
            padding: 14px 18px; min-width: 300px; color: #fff;
            font: 13px/1.5 monospace; letter-spacing: normal; text-align: left; }
#net-menu .nm-hd { font: 700 13px/1 monospace; letter-spacing: .12em;
                   text-transform: uppercase; opacity: .8; margin-bottom: 12px; }
#net-menu .nm-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
#net-menu .nm-lbl { width: 52px; font-size: 11px; letter-spacing: .08em;
                    text-transform: uppercase; opacity: .7; }
#net-menu input { flex: 1; min-width: 0; padding: 6px 8px; color: #fff;
                  font: 14px/1.2 monospace; letter-spacing: .06em;
                  background: rgba(255,255,255,.06);
                  border: 1px solid rgba(255,255,255,.15); outline: none; }
#net-menu input:focus { border-color: rgba(0,255,160,.55); }
#net-menu button { padding: 6px 10px; color: #fff; font: 12px/1.2 monospace;
                   letter-spacing: .08em; text-transform: uppercase;
                   background: rgba(255,255,255,.06);
                   border: 1px solid rgba(255,255,255,.15); cursor: pointer; }
#net-menu button:hover { background: rgba(255,255,255,.14); }
#net-menu button:disabled { opacity: .4; cursor: not-allowed; }
#net-menu .nm-new { flex: 0 0 auto; }
#net-menu .nm-go { width: 100%; margin-top: 10px; padding: 8px 10px; font-size: 13px; }
#net-menu .nm-status { margin-top: 10px; font: 11px/1.4 monospace; min-height: 1.4em;
                       opacity: .85; word-break: break-word; }
#net-menu .nm-status.err { color: #ff6b6b; opacity: 1; }
#net-menu .nm-status.ok { color: #34d15b; opacity: 1; }
`;

// A short, readable room code.
export function randomRoomCode(len = 4) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export class NetMenu {
  // `net` is a NetClient (src/net/netClient.js, owned elsewhere). Only three things are
  // assumed of it, each probed before use so a partial client cannot throw:
  //   net.onStatus  — assignable callback(message, kind?) the client calls to report
  //   net.connect(room, name) — may return a promise; rejection is shown, never thrown
  //   net.disconnect()
  //   net.connected — optional boolean, read to re-sync the button label
  // `onJoin` / `onLeave` override the connect/disconnect calls entirely, so main.js can
  // wire this to something else without the panel changing.
  constructor({ net = null, onJoin = null, onLeave = null, defaultName = 'player' } = {}) {
    this.net = net;
    this.onJoin = onJoin;
    this.onLeave = onLeave;
    this.connected = false;
    this._busy = false;
    this._injectStyle();
    this._build(defaultName);
    this._bindNet();
  }

  _injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  _build(defaultName) {
    const saved = this._load();
    const host = document.getElementById('lock-overlay') || document.body;

    const root = document.createElement('div');
    root.id = 'net-menu';
    root.innerHTML = `
      <div class="nm-hd">Multiplayer</div>
      <div class="nm-row"><span class="nm-lbl">Name</span>
        <input id="nm-name" type="text" maxlength="16" spellcheck="false"
               autocomplete="off" placeholder="player"></div>
      <div class="nm-row"><span class="nm-lbl">Room</span>
        <input id="nm-room" type="text" maxlength="8" spellcheck="false"
               autocomplete="off" placeholder="ABCD">
        <button class="nm-new" id="nm-new" type="button">New</button></div>
      <button class="nm-go" id="nm-go" type="button">Join</button>
      <div class="nm-status" id="nm-status">Offline — single-player</div>`;
    host.appendChild(root);

    this.root = root;
    this.nameEl = root.querySelector('#nm-name');
    this.roomEl = root.querySelector('#nm-room');
    this.newEl = root.querySelector('#nm-new');
    this.goEl = root.querySelector('#nm-go');
    this.statusEl = root.querySelector('#nm-status');

    this.nameEl.value = saved.name || defaultName;
    this.roomEl.value = saved.room || randomRoomCode();

    this._trapEvents(root);

    // Room codes are case-insensitive on the wire; normalise as it is typed so two
    // players who type "abcd" and "ABCD" land in the same room.
    this.roomEl.addEventListener('input', () => {
      const clean = this.roomEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean !== this.roomEl.value) this.roomEl.value = clean;
    });
    this.newEl.addEventListener('click', () => {
      if (this.connected) return;
      this.roomEl.value = randomRoomCode();
      this.roomEl.focus();
    });
    this.goEl.addEventListener('click', () => this.toggle());
    for (const el of [this.nameEl, this.roomEl]) {
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.toggle(); });
    }
    this._refresh();
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

  // Chain onto the client's status callback rather than replacing it, so a handler
  // main.js installed first still runs.
  _bindNet() {
    const net = this.net;
    if (!net) return;
    const prev = typeof net.onStatus === 'function' ? net.onStatus : null;
    try {
      net.onStatus = (msg, kind) => {
        if (prev) { try { prev(msg, kind); } catch (err) { /* a peer's handler must not break ours */ } }
        this.setStatus(msg, kind);
      };
    } catch (err) {
      // A frozen or getter-only client: fall back to the polling path in update().
    }
  }

  // Called by main.js when it owns the connection state, and by update().
  setConnected(connected) {
    if (this.connected === connected) return;
    this.connected = !!connected;
    this._busy = false;
    this._refresh();
  }

  // kind: 'err' | 'ok' | anything else for neutral. Also re-syncs the button from
  // net.connected, so a client that only reports through onStatus still drives the UI.
  setStatus(message, kind = '') {
    if (!this.statusEl) return;
    this.statusEl.textContent = String(message == null ? '' : message);
    this.statusEl.className = `nm-status${kind === 'err' || kind === 'ok' ? ' ' + kind : ''}`;
    // Any terminal status ends the pending attempt. setConnected early-returns when
    // the connected flag has not changed, so without this a failed connect latches
    // the panel busy and Join stays disabled for the life of the page.
    if (kind === 'err' || kind === 'ok') this._busy = false;
    if (this.net && typeof this.net.connected === 'boolean') {
      this.setConnected(this.net.connected);
    } else {
      this._busy = false;
      this._refresh();
    }
  }

  // Optional: call from the frame loop to mirror net.connected without any callback.
  update() {
    if (this.net && typeof this.net.connected === 'boolean') {
      this.setConnected(this.net.connected);
    }
  }

  toggle() {
    if (this._busy) return;
    if (this.connected) this._leave(); else this._join();
  }

  _join() {
    if (!(this.roomEl.value || '').trim()) {
      this.setStatus('Enter a room code.', 'err');
      this.roomEl.focus();
      return;
    }
    // Normalise with the protocol's own helpers so the fields show exactly what the
    // relay will register and what the other players will see.
    const name = normaliseName(this.nameEl.value);
    const room = normaliseRoom(this.roomEl.value);
    this.nameEl.value = name;
    this.roomEl.value = room;
    this._save(name, room);
    this._busy = true;
    this.setStatus(`Connecting to ${room}…`);
    this._refresh();
    // Never throw out of the panel: a dead relay must leave single-player running.
    try {
      const r = this.onJoin ? this.onJoin(room, name)
        : (this.net && typeof this.net.connect === 'function' ? this.net.connect(room, name) : null);
      if (r && typeof r.catch === 'function') {
        r.catch((err) => this.setStatus(`Connect failed: ${err && err.message ? err.message : err}`, 'err'));
      }
      if (!this.onJoin && !(this.net && typeof this.net.connect === 'function')) {
        this.setStatus('No relay client wired up.', 'err');
      }
    } catch (err) {
      this.setStatus(`Connect failed: ${err && err.message ? err.message : err}`, 'err');
    }
  }

  _leave() {
    this._busy = true;
    this._refresh();
    try {
      if (this.onLeave) this.onLeave();
      else if (this.net && typeof this.net.disconnect === 'function') this.net.disconnect();
    } catch (err) {
      this.setStatus(`Disconnect failed: ${err && err.message ? err.message : err}`, 'err');
    }
    this.setConnected(false);
    this.setStatus('Offline — single-player');
  }

  _refresh() {
    if (!this.goEl) return;
    this.goEl.textContent = this._busy ? '…' : (this.connected ? 'Leave' : 'Join');
    this.goEl.disabled = this._busy;
    const lockFields = this._busy || this.connected;
    this.nameEl.disabled = lockFields;
    this.roomEl.disabled = lockFields;
    this.newEl.disabled = lockFields;
  }

  // localStorage can throw (private mode, disabled storage); a remembered name is not
  // worth a crash on the pause screen.
  _load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    } catch (err) {
      return {};
    }
  }

  _save(name, room) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ name, room }));
    } catch (err) { /* storage unavailable; the fields simply do not persist */ }
  }
}

// NOTE — src/core/input.js already skips keydown while an INPUT/TEXTAREA/contenteditable
// element has focus, so a text field anywhere on the page is safe. The stopPropagation
// above is belt-and-braces, and covers pointer events reaching #lock-overlay.
