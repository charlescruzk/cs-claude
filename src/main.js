// Entry point. P0-1 replaces this stub with the Engine + frame loop.
// Until then it proves the importmap and module loading work.
import * as THREE from 'three';

const status = document.getElementById('boot-status');
status.textContent = `three ${THREE.REVISION} loaded — scaffold ready, P0-1 not started`;

window.__game = { scaffold: true, three: THREE.REVISION };
