import * as THREE from 'three';
import { buildHumanoid, applyTeam } from '../geo/humanoid.js';
import { INTERP_DELAY_MS, MAX_SNAPSHOTS, FLAG, lerpAngle, unpackState } from './protocol.js';

// Other humans in the room: their meshes, their snapshot interpolation, and the
// hit boxes the local hitscan resolves against. The local player is never in
// here — it must never be rendered to itself nor appear in its own targets.
//
// The interpolation delay, buffer cap, flag bits and the wrap-safe angle lerp all
// come from protocol.js so the sender and the interpolator cannot drift apart.

// These must match Bot exactly: a shot that hits a bot-shaped silhouette has to
// hit a remote player standing in the same spot.
const BODY = 0.8;
const HEIGHT = 1.8;
const HEAD = 0.4;
const CROUCH_HEIGHT = 1.2; // playerController CROUCH_H
const TEAM_COLOR = { ct: 0x3355cc, t: 0xcc6633 };

// One NaN off the wire would poison a position for the rest of the session:
// every later lerp against it is NaN and the mesh vanishes.
function fin(v) {
  return Number.isFinite(v) ? v : 0;
}

// One peer: a snapshot buffer stamped with LOCAL receive time, the interpolated
// transform, and the box/headBox/onHit trio resolveShot needs.
export class RemotePlayer {
  constructor(id, name, team, scene) {
    this.id = id;
    this.name = name || id;
    this.team = team === 't' ? 't' : 'ct';
    this.dead = false;
    this.crouching = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.box = { min: new THREE.Vector3(), max: new THREE.Vector3() };
    this.headBox = { min: new THREE.Vector3(), max: new THREE.Vector3() };
    this.buffer = [];
    // A peer exists from the moment 'peer' arrives, but has no position until its
    // first state packet. Until then it must be neither drawn nor shootable, or it
    // is an invisible hit box standing at the world origin.
    this.ready = false;
    // Set by RemotePlayers so a hit is reported to the network, not applied here.
    this.reportHit = null;
    this._build(scene);
    this._syncMesh();
    this.root.visible = false; // revealed by the first snapshot
  }

  // Body + head in team colour with a dark nose for facing — same as a bot.
  _build(scene) {
    const { root, parts } = buildHumanoid(TEAM_COLOR[this.team] || 0x888888);
    this.root = root;
    this.parts = parts;
    scene.add(this.root);
  }

  // A state message may arrive before the 'peer' that names the team; swap the
  // shared material rather than rebuilding the meshes.
  setTeam(team) {
    const next = team === 't' ? 't' : 'ct';
    if (next === this.team) return;
    this.team = next;
    applyTeam(this.parts, TEAM_COLOR[next]);
  }

  // Stamp with the LOCAL clock. Peer clocks are not synchronised and nothing in
  // the protocol syncs them, so a sender's skew would otherwise shove this peer
  // permanently into the future or the past.
  pushSnapshot(x, y, z, yaw, pitch, flags) {
    const firstSnapshot = !this.ready;
    if (firstSnapshot) { this.ready = true; this.root.visible = true; }
    this.buffer.push({
      t: Date.now(),
      x: fin(x), y: fin(y), z: fin(z),
      yaw: fin(yaw), pitch: fin(pitch),
      flags: flags | 0,
    });
    // A paused tab keeps receiving while its rAF loop is throttled, so the
    // buffer is bounded and drained from the front.
    while (this.buffer.length > MAX_SNAPSHOTS) this.buffer.shift();
    return firstSnapshot; // caller rebuilds the targets array on the transition
  }

  // dt is unused: interpolation is driven by the wall clock, so a long frame
  // still renders the correct 100 ms-old position rather than drifting.
  update() {
    const buf = this.buffer;
    if (buf.length === 0) return;
    const render = Date.now() - INTERP_DELAY_MS;
    const last = buf[buf.length - 1];
    let a = buf[0];
    let b = a;
    let alpha = 0;
    if (render >= last.t) {
      // Underrun: freeze at the newest snapshot, never extrapolate. A guessed
      // position slides a silent peer through walls and leaves a phantom hit box
      // where nobody stands.
      a = last;
      b = last;
    } else if (render > buf[0].t) {
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1].t <= render) {
          a = buf[i - 1];
          b = buf[i];
          break;
        }
      }
      const span = b.t - a.t;
      alpha = span > 0 ? (render - a.t) / span : 1; // two stamps in the same ms
      if (alpha < 0) alpha = 0;
      else if (alpha > 1) alpha = 1;
    }
    this.pos.set(
      a.x + (b.x - a.x) * alpha,
      a.y + (b.y - a.y) * alpha,
      a.z + (b.z - a.z) * alpha,
    );
    this.yaw = lerpAngle(a.yaw, b.yaw, alpha);
    this.pitch = a.pitch + (b.pitch - a.pitch) * alpha;
    // Flags are discrete: hold the state we are rendering from until b is reached.
    const flags = a.flags;
    this.crouching = (flags & FLAG.CROUCHING) !== 0;
    this.dead = (flags & FLAG.DEAD) !== 0;
    this._syncMesh();
  }

  // Push the transform to the mesh and rewrite the hit boxes in place. Never
  // reallocates: these two objects are handed to resolveShot every frame.
  _syncMesh() {
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = this.dead ? Math.PI / 2 : 0; // lie the body down
    const base = this.pos.y;
    // Match the local player's capsule: crouching drops 1.8 m to 1.2 m. Without this
    // a crouching peer's head box floats 0.6 m above their actual head.
    const h = this.crouching ? CROUCH_HEIGHT : HEIGHT;
    this.root.scale.y = h / HEIGHT; // crouch squashes the figure to the hit-box height
    this.box.min.set(this.pos.x - BODY / 2, base, this.pos.z - BODY / 2);
    this.box.max.set(this.pos.x + BODY / 2, base + h, this.pos.z + BODY / 2);
    this.headBox.min.set(this.pos.x - HEAD / 2, base + h, this.pos.z - HEAD / 2);
    this.headBox.max.set(this.pos.x + HEAD / 2, base + h + HEAD, this.pos.z + HEAD / 2);
  }

  // resolveShot calls this on a hit. It deliberately applies NO damage: the
  // victim's own client owns its health, so we only report the hit upward and
  // the caller sends { t:'hit', to:this.id } over the wire.
  onHit(damage, headshot, weapon) {
    if (this.reportHit) this.reportHit(this.id, damage, headshot, weapon);
  }

  // Effects._frag calls takeDamage directly on every entry of getTargets(). Same
  // report-upward contract as onHit: the victim's client owns its own health.
  takeDamage(damage, headshot = false, weapon = null) {
    if (this.reportHit) this.reportHit(this.id, damage, headshot, weapon);
  }

  dispose(scene) {
    scene.remove(this.root);
    this.root.clear();
    this.buffer.length = 0;
    this.reportHit = null;
  }
}

// Owns every remote player in the room. `onHit(id, damage, headshot, weapon)` is
// set by the caller and fires whenever a local shot lands on a peer.
export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map();
    this.localId = null;
    this.onHit = null;
    this._targets = [];
    this._report = (id, damage, headshot, weapon) => {
      if (this.onHit) this.onHit(id, damage, headshot, weapon);
    };
  }

  // Belt and braces: the relay never echoes to the sender, but a future
  // authoritative server might, and shooting yourself must stay impossible.
  setLocalId(id) {
    this.localId = id || null;
    if (id) this.remove(id);
  }

  has(id) { return this.players.has(id); }
  get(id) { return this.players.get(id) || null; }
  list() { return this._targets; }
  get count() { return this._targets.length; }

  // Add (or update) a peer from a 'joined' peers entry or a 'peer' message.
  add(peer) {
    if (!peer || !peer.id || peer.id === this.localId) return null;
    const existing = this.players.get(peer.id);
    if (existing) {
      if (peer.name) existing.name = peer.name;
      if (peer.team) existing.setTeam(peer.team);
      return existing;
    }
    const player = new RemotePlayer(peer.id, peer.name, peer.team, this.scene);
    player.reportHit = this._report;
    this.players.set(peer.id, player);
    this._rebuild();
    return player;
  }

  // Apply a state packet. Accepts either the raw { t:'s', p, y, a, f, id } or an
  // already-decoded protocol.unpackState() snapshot, so the socket layer can hand
  // over whichever it has.
  applyState(msg) {
    if (!msg || !msg.id || msg.id === this.localId) return null;
    const snap = Array.isArray(msg.pos) ? msg : unpackState(msg);
    if (!snap || !Array.isArray(snap.pos)) return null;
    // A state can beat its 'peer' announcement if a message is ever dropped or
    // reordered; a provisional body is safer than an invisible shooter.
    const player = this.players.get(msg.id) || this.add({ id: msg.id, name: msg.id });
    if (!player) return null;
    if (player.pushSnapshot(snap.pos[0], snap.pos[1], snap.pos[2], snap.yaw, snap.pitch, snap.flags)) {
      this._rebuild(); // first position seen: this peer is now drawable and shootable
    }
    return player;
  }

  // Both the mesh and the hit box go: a stale box is a bullet sponge in mid-air.
  remove(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    player.dispose(this.scene);
    this._rebuild();
  }

  // Full teardown on disconnect.
  clear() {
    for (const player of this.players.values()) player.dispose(this.scene);
    this.players.clear();
    this._rebuild();
  }

  // Same contract as BotManager.targets(): entries carry dead/box/headBox/onHit.
  // The array is rebuilt only on add/remove, so the shot path allocates nothing.
  targets() { return this._targets; }

  update(dt) {
    for (const player of this.players.values()) player.update(dt);
  }

  // Only peers that have reported a position are drawn or shootable.
  _rebuild() {
    this._targets.length = 0;
    for (const p of this.players.values()) if (p.ready) this._targets.push(p);
  }
}
