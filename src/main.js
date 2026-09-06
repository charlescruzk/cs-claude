// Entry point. Wires engine, input, map, player, and weapons together and runs the
// frame loop. The player controller owns the camera (a yaw rig) and moves with
// collision; the weapon fires on click and each shot is resolved by a hitscan
// against the map. The loop only drives the player/weapon while the pointer is
// locked (the overlay is the "paused" state). Bots and the round loop arrive next.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
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
import { Scoreboard } from './hud/scoreboard.js';
import { BuyMenu } from './hud/buyMenu.js';
import { Round } from './game/round.js';
import { spawnFor } from './game/teams.js';
import { debugEnabled, makeFpsCounter, makeColliderBoxes } from './core/debug.js';

const status = document.getElementById('boot-status');
const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('lock-overlay');

const engine = new Engine(canvas);
const input = new Input(canvas);
// Surface an update-loop failure on screen instead of a silent frozen frame.
engine.onError = (err) => { status.textContent = 'UPDATE ERROR: ' + err.message; status.style.color = '#ff6b6b'; };

overlay.addEventListener('click', () => input.requestLock());
input._onLockChange = (locked) => overlay.classList.toggle('hidden', locked);

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
const weapon = new Weapon('pistol');
const viewmodel = new Viewmodel(engine.camera, controller, weapon);

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
  for (let i = 0; i < pellets; i++) {
    _shotDir.copy(_shotBase)
      .add(_shotRand.set(
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s,
        (Math.random() - 0.5) * 2 * s))
      .normalize();
    resolveShot(p.origin, _shotDir, map.colliders, botManager.targets(), p.weapon);
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

window.__game = {
  engine, input, events, map, controller, player, weapon, viewmodel, botManager,
  hud, round, scoreboard, buyMenu,
  three: THREE.REVISION,
};

engine.start((dt) => {
  input.beginFrame();
   // The round loop and combat systems run only while locked; overlay-up pauses.
  if (input.locked) {
    round.update(dt);
    controller.update(dt, input, map.colliders);
    weapon.update(dt, input, engine.camera);
      // Scoped aim eases the FOV to ~30 and slows the player to a half-pace.
    const targetFov = weapon.scoped ? 30 : 90;
    engine.camera.fov += (targetFov - engine.camera.fov) * (1 - Math.exp(-dt / 0.08));
    engine.camera.updateProjectionMatrix();
    controller.moveScale = weapon.scoped ? 0.5 : 1;
    if (round.state === 'live') botManager.update(dt, controller, map.colliders);
     }
  viewmodel.update(dt);
  scoreboard.update(dt, input);
  hud.update(dt, { player, weapon, round, spread: weapon.currentSpread, scoped: weapon.scoped });
  // The buy menu runs unlocked so it stays live while its pointer-lock release is up.
  buyMenu.update(dt, input);
  input.endFrame();
  fps(dt);
});

status.textContent = `three r${THREE.REVISION} — P0-8 Round loop (freeze/live/end + scoreboard)`;
