// Entry point. P0-1 wires the Engine + shared event bus and starts the loop.
// Later tasks extend the update function to drive each system in turn.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { events } from './core/events.js';

const status = document.getElementById('boot-status');
const canvas = document.getElementById('game-canvas');

const engine = new Engine(canvas);

engine.start((dt) => {
  // P0-1: nothing to update yet. The loop and a correct render are the deliverable.
  void dt;
});

// Expose for debugging in the console.
window.__game = { engine, events, three: THREE.REVISION };
status.textContent = `three r${THREE.REVISION} — P0-1 engine running`;
