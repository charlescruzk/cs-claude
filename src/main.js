// Entry point. P0-3 swaps the P0-1 test cube for the blockout map and parks the
// camera on a T spawn so the map is visible on load. The loop still only drives
// input; the player controller takes over the camera in P0-4.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { events } from './core/events.js';
import { mapData } from './map/mapData.js';
import { buildMap } from './map/mapBuilder.js';

const status = document.getElementById('boot-status');
const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('lock-overlay');

const engine = new Engine(canvas);
const input = new Input(canvas);

overlay.addEventListener('click', () => input.requestLock());
input._onLockChange = (locked) => overlay.classList.toggle('hidden', locked);

// Replace the P0-1 placeholder with the blockout map.
engine.clearTestWorld();
const map = buildMap(mapData, engine.scene);

// Static camera on a T spawn, looking into the map (P0-4 replaces this with look).
engine.camera.position.set(0, 1.6, -24);
engine.camera.lookAt(0, 1.6, 0);

window.__game = { engine, input, events, map, three: THREE.REVISION };

engine.start((dt) => {
  input.beginFrame();
    // P0-3: map is built and rendered; no systems update yet.
  void dt;
  input.endFrame();
});

status.textContent = `three r${THREE.REVISION} — P0-3 map built (${map.colliders.length} colliders)`;
