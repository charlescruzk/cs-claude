import * as THREE from 'three';

// Rendering + loop only. The Engine knows nothing about the game; it creates the
// scene/camera/renderer, keeps the aspect ratio correct on resize, and drives a
// requestAnimationFrame loop that hands a dt (clamped to 0.1s) to the update fn.
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb8de); // pale sky
    this.scene.fog = new THREE.Fog(0x8fb8de, 70, 240);

    this.camera = new THREE.PerspectiveCamera(
      90, window.innerWidth / window.innerHeight, 0.05, 500
    );
    this.camera.position.set(0, 1.6, 8);

    this.clock = new THREE.Clock();

    // Soft ambient fill from the hemisphere + a directional "sun".
    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x445566, 1.0);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(60, 90, 40);
    this.scene.add(this.sun);

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this._frame = this._frame.bind(this);
    this._running = false;
    this._reportedError = false; // an update error is reported once, not every frame
    this.onError = null; // optional main.js hook: show the error on screen
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Start the loop. `updateFn(dt)` runs once per frame with dt clamped to 0.1s,
  // then the scene renders. The cap is what keeps a tab-away from teleporting.
  start(updateFn) {
    this._updateFn = updateFn;
    this._running = true;
    requestAnimationFrame(this._frame);
  }

  _frame() {
    if (!this._running) return;
    requestAnimationFrame(this._frame);
    let dt = this.clock.getDelta();
    if (dt > 0.1) dt = 0.1;
    try {
      this._updateFn(dt);
      } catch (err) {
        // Report once, then keep rendering so the failure is visible on screen
        // rather than freezing the last good frame.
        if (!this._reportedError) {
          this._reportedError = true;
          console.error('[engine] update failed:', err);
          if (this.onError) this.onError(err);
          }
        }
    this.renderer.render(this.scene, this.camera);
  }

  stop() {
    this._running = false;
  }
}
