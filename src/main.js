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

const status = document.getElementById('boot-status');
const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('lock-overlay');

const engine = new Engine(canvas);
const input = new Input(canvas);

overlay.addEventListener('click', () => input.requestLock());
input._onLockChange = (locked) => overlay.classList.toggle('hidden', locked);

// Build the blockout and drop the P0-1 test cube.
engine.clearTestWorld();
const map = buildMap(mapData, engine.scene);

// Player: spawn the controller at a random T spawn and give it the map colliders.
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const spawn = pick(map.spawns.t); // one [x, z] pair
const firstSpawn = { x: spawn[0], z: spawn[1] };
const controller = new PlayerController(engine.camera, input, map.colliders, firstSpawn);
engine.scene.add(controller.yawObject);
const player = new PlayerState();
controller.state = player; // bots read the player's combat state via the controller

// Bots: a squad of CT bots patrol the map, engage the T player on line-of-sight,
// and take hits from the player's hitscan. They are the round's enemy team.
const botManager = new BotManager(engine.scene, map.spawns);

// Weapons: start on the pistol (key 1); key 2 swaps to the rifle. Every shot is
// resolved against the map and the bot targets.
const weapon = new Weapon('pistol');
const viewmodel = new Viewmodel(engine.camera, controller);
events.on('shot', (p) => resolveShot(p.origin, p.dir, map.colliders, botManager.targets(), p.weapon));

// HUD: reads live player/weapon/round state each frame and reacts to hit/kill.
// `round` is a stand-in countdown for P0-7; P0-8 replaces it with the round loop.
const round = { time: 115 };
const hud = new Hud();

window.__game = {
  engine, input, events, map, controller, player, weapon, viewmodel, botManager,
  hud, round,
  three: THREE.REVISION,
};

engine.start((dt) => {
  input.beginFrame();
   // Only move while locked; the overlay-up state is effectively paused.
  if (input.locked) {
    controller.update(dt, input, map.colliders);
    weapon.update(dt, input, engine.camera);
    botManager.update(dt, controller, map.colliders);
    round.time = Math.max(0, round.time - dt);
     }
  viewmodel.update(dt);
  hud.update(dt, { player, weapon, round, spread: weapon.currentSpread });
  input.endFrame();
});

status.textContent = `three r${THREE.REVISION} — P0-7 HUD (crosshair, health/armor, ammo, timer, feed)`;
