// Entry point. P0-4 adds the player controller: it owns the camera via a yaw rig,
// moves with collision against the map, and spawns at a random T spawn. The loop
// only drives the player while the pointer is locked (the overlay is the "paused"
// state). Weapons, bots, and the round loop arrive in later tasks.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { events } from './core/events.js';
import { mapData } from './map/mapData.js';
import { buildMap } from './map/mapBuilder.js';
import { PlayerController } from './player/playerController.js';
import { PlayerState } from './player/playerState.js';

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

window.__game = { engine, input, events, map, controller, player, three: THREE.REVISION };

engine.start((dt) => {
  input.beginFrame();
   // Only move while locked; the overlay-up state is effectively paused.
  if (input.locked) controller.update(dt, input, map.colliders);
  input.endFrame();
});

status.textContent = `three r${THREE.REVISION} — P0-4 player moving (WASD/mouse, click to play)`;
