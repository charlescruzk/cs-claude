// Entry point. Wires engine, input, map, player, and weapons together and runs the
// frame loop. The player controller owns the camera (a yaw rig) and moves with
// collision; the weapon fires on click and each shot is resolved by a hitscan
// against the map. The loop only drives the player/weapon while the pointer is
// locked (the overlay is the "paused" state). Bots and the round loop arrive next.
import * as THREE from 'three';
import { Engine, vFovFor, BASE_HFOV, SCOPED_HFOV } from './core/engine.js';
import { Input } from './core/input.js';
import { events } from './core/events.js';
import { mapData } from './map/mapData.js';
import { buildMap } from './map/mapBuilder.js';
import { PlayerController } from './player/playerController.js';
import { PlayerState } from './player/playerState.js';
import { Weapon } from './weapons/weapon.js';
import { Viewmodel } from './weapons/viewmodel.js';
import { resolveShot } from './weapons/hitscan.js';
import { BotManager } from './bots/botManager.js';
import { Hud } from './hud/hud.js';
import { Hitmarker } from './hud/hitmarker.js';
import { Scoreboard } from './hud/scoreboard.js';
import { BuyMenu } from './hud/buyMenu.js';
import { Round } from './game/round.js';
import { ProjectileManager } from './game/projectile.js';
import { Tactical } from './weapons/tactical.js';
import { Effects } from './game/effects.js';
import { spawnFor } from './game/teams.js';
import { Audio } from './audio/audio.js';
import { Sfx } from './audio/sfx.js';
import { NetClient } from './net/netClient.js';
import { RemotePlayers } from './net/remotePlayers.js';
import { packFlags } from './net/protocol.js';
import { NetMenu } from './hud/netMenu.js';
import { SettingsMenu } from './hud/settingsMenu.js';
import { weaponData, WEAPON_KEYS } from './weapons/weaponData.js';
import { debugEnabled, makeFpsCounter, makeColliderBoxes, makeFrameWatchdog,
         diagEnabled, makeDiagPanel } from './core/debug.js';

const status = document.getElementById('boot-status');
const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('lock-overlay');

const engine = new Engine(canvas);
const input = new Input(canvas);
// Surface an update-loop failure on screen instead of a silent frozen frame.
engine.onError = (err) => { status.textContent = 'UPDATE ERROR: ' + err.message; status.style.color = '#ff6b6b'; };

// Audio must be unlocked from inside a real user gesture; the click that starts
// the game is the one gesture we are guaranteed to get.
const audio = new Audio();
const sfx = new Sfx(audio);
const playBtn = document.getElementById('play-btn');
overlay.addEventListener('click', () => { audio.unlock(); input.requestLock(); });
// A refused pointer lock must not die silently: the whole game is gated on it, so
// report the failure on screen the way index.html reports a boot error.
input._onLockError = (msg) => {
  status.textContent = 'POINTER LOCK FAILED: ' + msg +
     '\nThe game only runs while the pointer is locked. Click again, or check the site\'s ' +
     'pointer-lock permission in your browser settings.';
  status.style.color = '#ff6b6b';
  status.style.whiteSpace = 'pre-wrap';
};

// Build the blockout.
const map = buildMap(mapData, engine.scene);
// ?debug=1: a fixed FPS readout plus a green wireframe box over every collider.
// Both stay inert without the flag (fps is a no-op, no group is built).
const debug = debugEnabled();
if (debug) engine.scene.add(makeColliderBoxes(map.colliders));
const fps = debug ? makeFpsCounter() : () => {};

// Player: spawn the controller at a random T spawn and give it the map colliders.
const firstSpawn = spawnFor('t', map.spawns);
const controller = new PlayerController(engine.camera, input, map.colliders, firstSpawn);
engine.scene.add(controller.yawObject);
const player = new PlayerState();
controller.state = player; // bots read the player's combat state via the controller

// Bots: a squad of CT bots patrol the map, engage the T player on line-of-sight,
// and take hits from the player's hitscan. They are the round's enemy team.
const botManager = new BotManager(engine.scene, map.spawns);

// Weapons: keys 1-4 switch the pistol/rifle/shotgun/sniper. One 'shot' per pull
// fans out one perturbed hitscan per pellet, resolved against the map + bots.
const weapon = new Weapon('pistol', controller);
const viewmodel = new Viewmodel(engine.camera, controller, weapon);

// --- Multiplayer (opt-in) ----------------------------------------------------
// Nothing here touches the network until someone joins a room from the panel on
// the pause screen: the client opens no socket on construction, RemotePlayers is
// empty, and every per-frame call below is a guarded no-op. Single-player must
// behave exactly as it did before this existed.
const net = new NetClient();
const remotePlayers = new RemotePlayers(engine.scene);
// The weapon key of the shot being resolved right now. resolveShot calls a remote
// player's onHit synchronously inside the 'shot' handler below, and the weapon def
// it is handed carries no key, so the handler parks the key here for the message.
let shotKey = 'pistol';

// A hit on a peer is deliberately NOT applied here — the victim's own client owns
// its health. We only report what we saw. See the trust model in docs/MULTIPLAYER.md.
remotePlayers.onHit = (id, damage, headshot) => net.sendHit(id, damage, headshot, shotKey);
net.onPeer = (peer) => remotePlayers.add(peer);
net.onLeft = (id) => remotePlayers.remove(id);
net.onState = (snap) => remotePlayers.applyState(snap);
// Damage claimed by a peer's client. `killer` is that peer's name so the killfeed
// and scoreboard read correctly — and never the string 'player', which is what the
// kill handler below pays money for.
net.onHit = (hit) => {
  // Require an explicit match. The relay only routes a hit when `to` is set; one
  // without it falls through to broadcast and would damage every client in the room.
  if (!hit || !net.id || hit.to !== net.id) return;
  const from = remotePlayers.get(hit.id);
  player.takeDamage(hit.damage, hit.headshot, weaponData[hit.weapon] || null,
    (from && from.name) || hit.id || 'peer');
};

// The lobby panel. It lives inside #lock-overlay, so it is only reachable on the
// pause screen and is hidden the moment the pointer locks.
const netMenu = new NetMenu({
  net,
  defaultName: 'player',
  // Join is the only action that may surface anything network-related: before it,
  // no status line, socket state, or peer is visible to a player who never asked
  // for multiplayer. The onStatus wrapper below stays silent until this fires.
  onJoin: (room, name) => {
    joinAttempted = true;
    return net.connect(room, name);
  },
  // The menu's own Leave path calls disconnect(), which closes the socket quietly
  // and so never reports 'closed'; drop the peers here or their hit boxes survive.
  onLeave: () => { net.disconnect(); remotePlayers.clear(); },
});
// NetMenu chained itself onto net.onStatus in its constructor. Wrap that wrapper:
// 'connected'/'closed' is the one machine-readable signal the client gives for a
// session starting and ending, and the panel only colours the kinds 'ok'/'err'.
const menuStatus = net.onStatus;
let joinAttempted = false;
net.onStatus = (text, kind) => {
  // With no room joined there is no connection state to report: any message that
  // arrived before the player pressed Join is not theirs to see.
  if (!joinAttempted) return;
  if (kind === 'connected') {
    remotePlayers.clear();          // drop anything left over from a previous room
    remotePlayers.setLocalId(net.id); // we are never our own target
  } else if (kind === 'closed') {
    // Only a real session end clears peers. 'error' also covers recoverable cases
    // (a failed send, a relay refusal over a healthy socket) where wiping every
    // peer's name and team would be wrong.
    // A dropped connection must take the meshes AND the hit boxes with it: a stale
    // box is a bullet sponge hanging in mid-air where nobody is standing.
    remotePlayers.clear();
  }
  if (menuStatus) {
    menuStatus(text, kind === 'connected' ? 'ok'
      : (kind === 'error' || kind === 'closed') ? 'err' : '');
  }
};

// Settings: a pause-screen panel (bottom-left) for sensitivity, weapon bob, volume
// and invert-Y. It applies live and persists; it never runs while the pointer is
// locked, so it has no per-frame cost.
const settingsMenu = new SettingsMenu({ controller, viewmodel, audio });

// Bots plus peers in one array for resolveShot. Rebuilt once per shot, never per
// pellet (a shotgun pull is 8), and skipped entirely while offline so the
// single-player shot path allocates and copies nothing.
const _shotTargets = [];
function shotTargets() {
  const bots = botManager.targets();
  const remotes = remotePlayers.targets();
  if (remotes.length === 0) return bots;
  _shotTargets.length = 0;
  for (const b of bots) _shotTargets.push(b);
  for (const r of remotes) _shotTargets.push(r);
  return _shotTargets;
}

// Scratch vectors for the per-pellet fan-out, reused each shot (no per-pellet alloc).
const _shotBase = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
const _shotRand = new THREE.Vector3();
// A pellet weapon (shotgun) carries several directions per pull: fan out one
// hitscan per pellet, each a fresh cone perturbation at the weapon's live spread.
events.on('shot', (p) => {
  engine.camera.getWorldDirection(_shotBase);
  const pellets = p.pellets || 1;
  const s = weapon.currentSpread;
  // The weapon def carries no key; the live Weapon does. One shot message per
  // pull, not per pellet — peers only need to know we fired.
  shotKey = WEAPON_KEYS[weapon.index] || 'pistol';
  if (net.connected) net.sendShot(p.origin, p.dir, shotKey);
  const targets = shotTargets();
  for (let i = 0; i < pellets; i++) {
    _shotDir.copy(_shotBase)
      .add(_shotRand.set(
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s))
      .normalize();
    resolveShot(p.origin, _shotDir, map.colliders, targets, p.weapon);
   }
 });

// Kills: award money on a player kill (+300 base, +100 for a headshot). The
// economy persists across rounds — PlayerState.reset only resets health/alive.
events.on('kill', (p) => {
  if (p.killer === 'player') player.money += 300 + (p.headshot ? 100 : 0);
   });

// Round loop: freeze -> live -> end -> reset. It owns the timer the HUD reads and,
// on reset, respawns the player and bots and refills the weapons.
const round = new Round({ player, controller, weapon, bots: botManager, spawns: map.spawns });
// HUD: reads live player/weapon/round state each frame and reacts to hit/kill.
const hud = new Hud();
// Scoreboard: a Tab-held overlay of team scores and per-participant K/D, plus the
// result banner shown during the end state.
const scoreboard = new Scoreboard({ bots: botManager, round });
// Buy menu: a freeze-phase panel (B) for Kevlar / Kevlar+Helmet / Magazine Pack.
// It runs outside the locked block so it works while its pointer-lock release is up.
const buyMenu = new BuyMenu(player, weapon, round, input);
// Hitmarker: four ticks confirming a landed shot, driven by update(dt) like the HUD.
const hitmarker = new Hitmarker();

// The buy menu deliberately releases pointer lock so the panel can be clicked;
// the overlay must not re-arm on top of it. It re-arms when the menu closes.
input._onLockChange = (locked) => {
  overlay.classList.toggle('hidden', locked || buyMenu._shown);
  // Once the game has been entered, the title screen becomes the pause screen.
  if (locked && playBtn) { playBtn.textContent = '\u25B6 RESUME'; overlay.classList.add('paused'); }
};

// Thrown tacticals: G/H spawn an arcing frag or flash into the ProjectileManager,
// which integrates and detonates them. The effects themselves land in P1-6.
const projectiles = new ProjectileManager(engine.scene);
const tactical = new Tactical(projectiles, engine.camera, controller);
// Effects react to a 'tactical' detonation: frag blast damage + explosion + orange
// flash, and a flash white-out when the player has line of sight to the impact.
const effects = new Effects({
  scene: engine.scene, colliders: map.colliders,
  // Peers as well as bots, so a frag at someone's feet actually hurts them.
  // RemotePlayer.takeDamage reports upward instead of applying damage locally.
  player: controller, getTargets: shotTargets,
});

// ?diag=1: a live state panel (fps/frames/locked/pointerLockElement/visibility/
// round/player pos/update error), refreshed each frame; inert without the flag.
const diagPanel = diagEnabled() ? makeDiagPanel(engine, input, round, controller) : () => {};

window.__game = {
  engine, input, events, map, controller, player, weapon, viewmodel, botManager,
  hud, hitmarker, round, scoreboard, buyMenu, projectiles, tactical, effects, audio, sfx,
  net, remotePlayers, netMenu, settingsMenu,
  three: THREE.REVISION,
};

engine.start((dt) => {
  input.beginFrame();
   // The round loop and combat systems run only while locked; overlay-up pauses.
  if (input.locked) {
    round.update(dt);
    controller.update(dt, input, map.colliders);
    weapon.update(dt, input, engine.camera);
      // Scoped aim eases the FOV to ~40 horizontal and slows the player to a half-pace.
    const aspect = engine.camera.aspect;
    const targetFov = vFovFor(weapon.scoped ? SCOPED_HFOV : BASE_HFOV, aspect);
    engine.camera.fov += (targetFov - engine.camera.fov) * (1 - Math.exp(-dt / 0.08));
    engine.camera.updateProjectionMatrix();
    controller.moveScale = weapon.scoped ? 0.5 : 1;
    if (round.state === 'live') botManager.update(dt, controller, map.colliders);
    botManager.updateDead(dt, map.colliders); // ragdolls settle regardless of state
        // Thrown tacticals: read G/H then integrate any in-flight nade.
    tactical.update(dt, input, engine.camera);
    projectiles.update(dt, map.colliders);
     }
   // Networking runs OUTSIDE the locked gate on purpose. Inside it, one player
   // opening the buy menu or losing pointer lock would stop sending state — their
   // body would freeze for everyone else — and would stop interpolating peers, so
   // the world would jump on unpause. Both calls return immediately when no room
   // is joined, and sendState is guarded so single-player packs nothing.
  if (net.connected) {
    net.sendState(controller.pos, controller.yaw, controller.pitch,
      packFlags({ crouching: controller.crouching, dead: !player.alive }));
  }
  net.update(dt);
  remotePlayers.update(dt);
   // The lobby panel is only visible while unlocked; mirror the connection there.
  if (!input.locked) netMenu.update();
  viewmodel.update(dt);
  scoreboard.update(dt, input);
   // Effects fade the screen overlays every frame; the HUD then paints them.
  effects.update(dt);
  hud.update(dt, { player, weapon, round, spread: weapon.currentSpread, scoped: weapon.scoped,
    whiteout: effects.whiteout, flash: effects.flash, tactical: tactical.ready() });
  hitmarker.update(dt);
  // The buy menu runs unlocked so it stays live while its pointer-lock release is up.
  buyMenu.update(dt, input);
  input.endFrame();
  fps(dt);
  diagPanel(dt);
});

// Watchdog (debug.js): a silent stall while locked becomes an on-screen diagnosis.
makeFrameWatchdog(engine, input, status, round);
status.textContent = `three r${THREE.REVISION} — P0-8 Round loop (freeze/live/end + scoreboard)`;
