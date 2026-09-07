import * as THREE from 'three';

// Rendering + loop only. The Engine knows nothing about the game; it creates the
// scene/camera/renderer, keeps the aspect ratio correct on resize, and drives a
// requestAnimationFrame loop that hands a dt (clamped to 0.1s) to the update fn.
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Render at 1 device pixel per CSS pixel. On a Retina display the default
    // min(dpr, 2) means ~4x the pixels, and every screen-space effect later in this
    // project (AO, volumetrics, bloom) scales directly with that. Anti-aliasing comes
    // from SMAA in the post stack instead. `?rs=2` forces the old behaviour for
    // side-by-side comparison.
    const rsParam = Number(new URLSearchParams(location.search).get('rs'));
    const renderScale = Number.isFinite(rsParam) && rsParam > 0
      ? Math.min(rsParam, 2)
      : 1;
    this.renderer.setPixelRatio(renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb8de); // pale sky
    this.scene.fog = new THREE.Fog(0x8fb8de, 70, 240);

    this.camera = new THREE.PerspectiveCamera(
      90, window.innerWidth / window.innerHeight, 0.05, 500
    );
    this.camera.position.set(0, 1.6, 8);

    this.clock = new THREE.Clock();

    // Ambient fill from the hemisphere + a directional "sun". The hemisphere is the
    // ONLY light reaching surfaces out of direct sun, so its intensity sets how far
    // shadows crush. At 0.45 against a 3.2 sun the shadow side went unreadable, which
    // is a gameplay problem before it is a looks problem. Lifted to a ~2.6:1 ratio and
    // the ground tint warmed, as a stand-in for the bounce light Stage C will bake —
    // once the GI volume lands, this fill should come back down.
    this.hemisphere = new THREE.HemisphereLight(0xbcd3f0, 0x6f6357, 1.15);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.0);
    this.sun.position.set(60, 90, 40);
    this.scene.add(this.sun);

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // A tight ortho frustum fitted to the real world extents (x/z are -30.5..30.5).
    // The default frustum would spend the whole shadow map on empty space.
    const s = this.sun.shadow.camera;
    s.left = -35; s.right = 35; s.top = 35; s.bottom = -35;
    s.near = 1; s.far = 220;
    s.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this._frame = this._frame.bind(this);
    this._running = false;
    this.frames = 0;                // frames the loop has run; the watchdog reads this
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
    this.frames++; // count every rAF call so the watchdog can tell a stall from life
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
