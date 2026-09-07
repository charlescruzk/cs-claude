// Browser side of the multiplayer relay: one WebSocket, a 20 Hz state pump driven
// by the game's own frame loop, and a set of settable handlers.
//
// Nothing in this file throws. A socket callback that throws unwinds into browser
// internals where no `try` of ours can catch it, so every failure is routed to
// onStatus instead and the game keeps running single-player.
import {
  MSG,
  STATE_INTERVAL,
  packState,
  packShot,
  packHit,
  packJoin,
  unpackState,
  unpackShot,
  unpackHit,
  normaliseRoom,
  normaliseName,
} from './protocol.js';

const DEFAULT_RELAY = 'ws://localhost:8081';
const OPEN = 1; // WebSocket.OPEN, spelled out so this module needs no global

// Hosts browsers treat as trustworthy, and so exempt from mixed-content blocking.
// 0.0.0.0 is NOT loopback: browsers do not exempt it, so treating it as trustworthy
// would let the https + ws:// case through to a silent failure.
const LOOPBACK = new Set(['localhost', '::1', '[::1]']);

function isLoopback(host) {
  const h = String(host || '').toLowerCase();
  if (LOOPBACK.has(h) || h.endsWith('.localhost')) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h); // the whole 127.0.0.0/8 block
}

// Pick the relay URL: ?relay=... wins, else the local default. http/https forms
// are rewritten, since that is what people paste.
export function resolveRelayUrl(search = null) {
  let raw = '';
  try {
    const q = search !== null ? search : (typeof location !== 'undefined' ? location.search : '');
    raw = new URLSearchParams(q).get('relay') || '';
  } catch {
    raw = '';
  }
  raw = raw.trim();
  if (!raw) return DEFAULT_RELAY;
  if (raw.startsWith('http://')) return `ws://${raw.slice(7)}`;
  if (raw.startsWith('https://')) return `wss://${raw.slice(8)}`;
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
  return `ws://${raw}`;
}

// Returns an error string when the browser will refuse this socket, else null.
// An https page may not open ws:// — except to loopback, which is exempt — and
// the failure is otherwise silent: the socket just closes with no useful reason.
export function checkMixedContent(url, pageProtocol = null) {
  const proto = pageProtocol !== null
    ? pageProtocol
    : (typeof location !== 'undefined' ? location.protocol : 'http:');
  if (proto !== 'https:') return null;
  if (!url.startsWith('ws://')) return null;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return `Relay URL is not valid: ${url}`;
  }
  if (isLoopback(host)) return null;
  return `This page is https, so it cannot open the insecure relay ${url}. `
    + 'Browsers only exempt ws://localhost. Run the relay locally, or put it behind TLS and use wss://.';
}

export class NetClient {
  constructor(url = null) {
    this.url = url || resolveRelayUrl();
    this.socket = null;
    this.id = null;      // our own connection id, set by the 'joined' message
    this.room = null;
    this.name = 'player';
    this.team = null;
    this.connected = false; // true only between 'joined' and close
    this.status = '';

    // Handlers, all replaceable by the caller. Defaults are no-ops so an
    // unassigned one can never be the reason a socket callback blows up.
    this.onPeer = null;   // ({ id, name, team })
    this.onLeft = null;   // (id)
    this.onState = null;  // ({ id, t, pos, yaw, pitch, flags }) — t is receive time
    this.onShot = null;   // ({ id, origin, dir, weapon })
    this.onHit = null;    // ({ id, to, damage, headshot, weapon })
    this.onTeam = null;   // ('t' | 'ct')
    this.onStatus = null; // (text, kind) kind: connecting|connected|error|closed

    this._acc = 0;          // seconds since the last state send
    this._pendingState = null; // latest packed state, reused to avoid per-frame alloc
    this._hasState = false;
    this._closing = false;  // set by disconnect() so its close is not reported as a drop
  }

  get isOpen() {
    return !!this.socket && this.socket.readyState === OPEN;
  }

  // --- lifecycle -------------------------------------------------------------

  // Open the socket and join `room`. Returns false (and reports through onStatus)
  // when the attempt cannot even be made; a later failure arrives via onStatus too.
  connect(room, name) {
    this.disconnect();
    this._closing = false;
    this.room = normaliseRoom(room);
    this.name = normaliseName(name);

    if (typeof WebSocket === 'undefined') {
      return this._fail('This browser has no WebSocket support; staying in single-player.');
    }
    const mixed = checkMixedContent(this.url);
    if (mixed) return this._fail(mixed);

    let sock;
    try {
      sock = new WebSocket(this.url);
    } catch (err) {
      return this._fail(`Could not open ${this.url}: ${err && err.message ? err.message : err}`);
    }
    this.socket = sock;
    this._report(`Connecting to ${this.url}...`, 'connecting');

    // Only a successful join sets `connected`: an open socket is not enough,
    // because the room may be full.
    sock.onopen = () => this._send(packJoin(this.room, this.name));
    sock.onmessage = (ev) => this._receive(ev);
    // The browser withholds the reason for a failed handshake, so this is as
    // specific as an error can get.
    sock.onerror = () => this._report(`Relay unreachable at ${this.url}. Playing single-player.`, 'error');
    sock.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      this.id = null;
      this._hasState = false;
      if (this._closing) return;
      this._report(
        wasConnected ? 'Disconnected from relay.' : `Could not reach relay at ${this.url}.`,
        'closed'
      );
    };
    return true;
  }

  disconnect() {
    this._closing = true;
    const sock = this.socket;
    this.socket = null;
    this.connected = false;
    this.id = null;
    this._acc = 0;
    this._hasState = false;
    if (!sock) return;
    try {
      sock.onopen = null;
      sock.onmessage = null;
      sock.onerror = null;
      sock.onclose = null;
      sock.close();
    } catch { /* already closed or closing; nothing to do */ }
  }

  // --- sending ---------------------------------------------------------------

  // Record the local player's state. Call this every frame: it only writes into a
  // reused packet, and update() decides when the wire actually sees it.
  sendState(pos, yaw, pitch, flags) {
    if (!this.connected) return;
    this._pendingState = packState(pos, yaw, pitch, flags, this._pendingState);
    this._hasState = true;
  }

  // Drive the 20 Hz send rate off the game's dt. setInterval would be a second
  // timebase drifting against the frame loop, and would keep firing while the
  // rAF loop is throttled in a background tab.
  update(dt) {
    if (!this.connected) return;
    this._acc += Number.isFinite(dt) ? dt : 0;
    if (this._acc < STATE_INTERVAL) return;
    // Modulo, not zero: it keeps the cadence honest across uneven frames, and a
    // long stall collapses to a single send rather than a burst of stale packets.
    this._acc %= STATE_INTERVAL;
    if (this._hasState) this._send(this._pendingState);
  }

  // origin/dir are Vector3-like ({x,y,z}); weaponKey is a weaponData key ('rifle').
  sendShot(origin, dir, weaponKey) {
    if (!this.connected) return;
    this._send(packShot(origin, dir, weaponKey));
  }

  // Trust-based: we tell the victim it was hit and the victim applies it. The
  // relay validates nothing — see docs/MULTIPLAYER.md.
  sendHit(to, dmg, headshot, weaponKey) {
    if (!this.connected || !to) return;
    this._send(packHit(to, dmg, headshot, weaponKey));
  }

  // --- receiving -------------------------------------------------------------

  _receive(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return; // a malformed packet is dropped, never fatal
    }
    if (!msg || typeof msg.t !== 'string') return;
    // Belt and braces: the relay never echoes to the sender, but a future
    // authoritative server might, and we must never render or shoot ourselves.
    if (msg.id && msg.id === this.id && msg.t !== MSG.HIT) return;

    if (msg.t === MSG.JOINED) {
      this.id = msg.id;
      this.room = msg.room || this.room;
      this.connected = true;
      this._acc = 0;
      const peers = Array.isArray(msg.peers) ? msg.peers : [];
      this._report(`Joined room ${this.room} as ${this.name} (${peers.length} already here).`, 'connected');
      for (const p of peers) {
        if (!p || !p.id || p.id === this.id) continue;
        this._emit(this.onPeer, { id: p.id, name: p.name || 'player', team: p.team || 't' });
      }
      return;
    }
    if (msg.t === MSG.TEAM) {
      this.team = msg.team;
      this._emit(this.onTeam, msg.team);
      return;
    }
    if (msg.t === MSG.PEER) {
      if (!msg.id) return;
      this._emit(this.onPeer, { id: msg.id, name: msg.name || 'player', team: msg.team || 't' });
      return;
    }
    if (msg.t === MSG.LEFT) {
      this._emit(this.onLeft, msg.id);
      return;
    }
    if (msg.t === MSG.STATE) {
      // Date.now() here, at the moment of arrival: the sender's clock is not ours.
      const snap = unpackState(msg, Date.now());
      if (snap && snap.id) this._emit(this.onState, snap);
      return;
    }
    if (msg.t === MSG.SHOT) {
      const shot = unpackShot(msg);
      if (shot && shot.id) this._emit(this.onShot, shot);
      return;
    }
    if (msg.t === MSG.HIT) {
      const hit = unpackHit(msg);
      if (hit && hit.id !== this.id) this._emit(this.onHit, hit);
      return;
    }
    if (msg.t === MSG.ERROR) {
      this._report(`Relay refused: ${msg.reason || 'unknown reason'}.`, 'error');
    }
  }

  // --- plumbing --------------------------------------------------------------

  _send(obj) {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    try {
      this.socket.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      this._report(`Send failed: ${err && err.message ? err.message : err}`, 'error');
      return false;
    }
  }

  // A caller's handler throwing must not escape into the socket callback either.
  _emit(fn, arg) {
    if (typeof fn !== 'function') return;
    try {
      fn(arg);
    } catch (err) {
      this.status = `Handler error: ${err && err.message ? err.message : err}`;
      if (typeof console !== 'undefined') console.error('[net]', err);
    }
  }

  _report(text, kind) {
    this.status = text;
    if (typeof this.onStatus !== 'function') return;
    try {
      this.onStatus(text, kind);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[net]', err);
    }
  }

  _fail(text) {
    this._report(text, 'error');
    return false;
  }
}
