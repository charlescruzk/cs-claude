// The shared wire vocabulary for multiplayer. Both the browser client and the
// relay speak this; nothing here touches the DOM, Three.js or the network, so the
// whole file can be verified by reading it.
//
// Field names are one letter because state is sent 20x a second: over a minute
// that is 1200 packets per player, and `p`/`y`/`a`/`f` instead of the long names
// is roughly a third of each packet.

// --- message types -----------------------------------------------------------

export const MSG = {
  JOIN: 'join',     // client -> server, once
  JOINED: 'joined', // server -> the joiner: its id, room and current peers
  TEAM: 'team',     // server -> the joiner: which side it was put on
  PEER: 'peer',     // server -> room: someone arrived
  LEFT: 'left',     // server -> room: someone disconnected
  STATE: 's',       // client -> room, 20 Hz
  SHOT: 'shot',     // client -> room, per shot
  HIT: 'hit',       // client -> ONE peer (routed by `to`)
  ERROR: 'error',   // server -> client: room full, etc.
};

// --- tuning shared by client and interpolator --------------------------------

export const STATE_HZ = 20;
export const STATE_INTERVAL = 1 / STATE_HZ; // seconds between state packets

// Render remote players this far in the past. Two dropped 50 ms packets still
// land inside the buffer, so a hiccup costs smoothness rather than a visible stall.
export const INTERP_DELAY_MS = 100;

// A backgrounded tab still receives packets while its rAF loop is throttled, so
// the snapshot buffer has to be bounded or it grows without limit.
export const MAX_SNAPSHOTS = 20;

// --- flags bitfield ----------------------------------------------------------

export const FLAG = {
  CROUCHING: 1,
  DEAD: 2,
};

// Pack the boolean player modifiers into one integer.
export function packFlags({ crouching = false, dead = false } = {}) {
  return (crouching ? FLAG.CROUCHING : 0) | (dead ? FLAG.DEAD : 0);
}

export function unpackFlags(f) {
  const bits = toInt(f);
  return {
    crouching: (bits & FLAG.CROUCHING) !== 0,
    dead: (bits & FLAG.DEAD) !== 0,
  };
}

export function hasFlag(f, bit) {
  return (toInt(f) & bit) !== 0;
}

// --- numeric helpers ---------------------------------------------------------

const TAU = Math.PI * 2;

// Rounding is the compression: 2 decimals on a metre is 1 cm, well under the
// precision anyone can see on a body at range, and it shortens the JSON text.
export function round(v, decimals) {
  if (!Number.isFinite(v)) return 0;
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

function num(v) {
  return Number.isFinite(v) ? v : 0;
}

function toInt(v) {
  return Number.isFinite(v) ? Math.trunc(v) : 0;
}

// Shortest signed rotation from `from` to `to`, always in [-PI, PI).
//
// Lerping raw yaw from +3.10 to -3.10 takes the model the long way round — 355
// degrees of spin for a 4 degree turn. JS `%` keeps the sign of the dividend, so
// the negative case has to be folded back up by TAU before the shift.
export function shortestAngleDelta(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  const d = (to - from + Math.PI) % TAU;
  return (d < 0 ? d + TAU : d) - Math.PI;
}

// Wrap-safe angular lerp, for interpolating a remote player's yaw.
export function lerpAngle(from, to, alpha) {
  return num(from) + shortestAngleDelta(from, to) * num(alpha);
}

// --- state -------------------------------------------------------------------

// Build a { t:'s', p, y, a, f } packet. `out` lets a caller reuse one object and
// its position array so the 20 Hz send path allocates nothing per frame.
export function packState(pos, yaw, pitch, flags, out = null) {
  const msg = out || { t: MSG.STATE, p: [0, 0, 0], y: 0, a: 0, f: 0 };
  msg.t = MSG.STATE;
  if (!Array.isArray(msg.p) || msg.p.length !== 3) msg.p = [0, 0, 0];
  msg.p[0] = round(pos ? pos.x : 0, 2);
  msg.p[1] = round(pos ? pos.y : 0, 2);
  msg.p[2] = round(pos ? pos.z : 0, 2);
  msg.y = round(yaw, 3);
  msg.a = round(pitch, 3);
  msg.f = toInt(flags);
  return msg;
}

// Decode a state packet into a snapshot.
//
// `now` MUST be the LOCAL receive time. Peer clocks are never synchronised and
// there is no clock-sync handshake, so a sender-supplied timestamp — skewed by
// even 200 ms — would park that player permanently in the past or the future.
export function unpackState(msg, now = Date.now()) {
  if (!msg || !Array.isArray(msg.p) || msg.p.length < 3) return null;
  return {
    id: msg.id,
    t: now,
    pos: [num(msg.p[0]), num(msg.p[1]), num(msg.p[2])],
    yaw: num(msg.y),
    pitch: num(msg.a),
    flags: toInt(msg.f),
  };
}

// --- shots and hits ----------------------------------------------------------

export function packShot(origin, dir, weaponKey) {
  return {
    t: MSG.SHOT,
    o: [round(origin ? origin.x : 0, 2), round(origin ? origin.y : 0, 2), round(origin ? origin.z : 0, 2)],
    d: [round(dir ? dir.x : 0, 3), round(dir ? dir.y : 0, 3), round(dir ? dir.z : 0, 3)],
    w: String(weaponKey || 'pistol'),
  };
}

export function unpackShot(msg) {
  if (!msg || !Array.isArray(msg.o) || !Array.isArray(msg.d)) return null;
  return {
    id: msg.id,
    origin: [num(msg.o[0]), num(msg.o[1]), num(msg.o[2])],
    dir: [num(msg.d[0]), num(msg.d[1]), num(msg.d[2])],
    weapon: String(msg.w || 'pistol'),
  };
}

// `to` is the victim's connection id; the relay routes this to that peer alone
// instead of broadcasting it.
export function packHit(to, dmg, headshot, weaponKey) {
  return {
    t: MSG.HIT,
    to: String(to || ''),
    dmg: round(dmg, 2),
    hs: !!headshot,
    w: String(weaponKey || 'pistol'),
  };
}

export function unpackHit(msg) {
  if (!msg) return null;
  return {
    id: msg.id,
    to: msg.to,
    damage: num(msg.dmg),
    headshot: !!msg.hs,
    weapon: String(msg.w || 'pistol'),
  };
}

export function packJoin(room, name) {
  return {
    t: MSG.JOIN,
    room: normaliseRoom(room),
    name: normaliseName(name),
  };
}

// The relay applies exactly these limits (uppercase, 8 / 16 chars); matching them
// here means the name shown locally is the name the other players see.
export function normaliseRoom(room) {
  return String(room || '').trim().toUpperCase().slice(0, 8) || 'LOBBY';
}

export function normaliseName(name) {
  return String(name || '').trim().slice(0, 16) || 'player';
}
