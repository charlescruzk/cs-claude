// Entry point. P0-2 adds input capture + pointer lock on top of the P0-1 loop.
// Later tasks extend the update function to drive each system in turn.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { events } from './core/events.js';

const status = document.getElementById('boot-status');
const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('lock-overlay');

const engine = new Engine(canvas);
const input = new Input(canvas);

// Clicking the "Click to play" overlay (which covers the canvas) requests pointer
// lock. Show the overlay again whenever the lock is lost (Esc, tab-out, etc.).
overlay.addEventListener('click', () => input.requestLock());
input._onLockChange = (locked) => overlay.classList.toggle('hidden', locked);

engine.start((dt) => {
  input.beginFrame();
   // P0-2: input is captured. Movement and look arrive in P0-4.
  void dt;
  input.endFrame();
});

// Expose for debugging in the console.
window.__game = { engine, input, events, three: THREE.REVISION };
status.textContent = `three r${THREE.REVISION} — P0-2 input ready (click to play)`;
