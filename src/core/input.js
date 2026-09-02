// Per-frame input. Holds the set of currently-pressed keys, the mouse movement
// accumulated since the last frame, and the state of the three mouse buttons.
// Pointer lock is requested on a canvas/overlay click so the mouse becomes
// relative movement. beginFrame/endFrame reset the per-frame values.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();                  // held keys, by KeyboardEvent.code
    this.mouseDX = 0;                       // horizontal movement accumulated this frame
    this.mouseDY = 0;                       // vertical movement accumulated this frame
    this.mouseDown = [false, false, false]; // 0=left 1=middle 2=right
    this._pressed = new Set();              // codes that went down since last endFrame
    this._downCodes = new Set();            // codes currently held (edge detection)
    this.locked = false;
    this._onLockChange = null;              // callback(locked), set by main.js
    this._bind();
   }

   // True only on the frame a key transitioned from up to down.
  justPressed(code) {
    return this._pressed.has(code);
   }

  requestLock() {
    this.canvas.requestPointerLock();
   }

  _bind() {
    window.addEventListener('keydown', (e) => {
       // Stop the page from scrolling / changing focus while these are held.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
       }
      if (!this._downCodes.has(e.code)) {
        this._downCodes.add(e.code);
        this._pressed.add(e.code);
       }
      this.keys.add(e.code);
     });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this._downCodes.delete(e.code);
     });

    this.canvas.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
     });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
     });
     // Only accumulate movement while locked, so a click-to-lock never injects a delta.
    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
       }
     });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this._onLockChange) this._onLockChange(this.locked);
     });
     // Right button is secondary fire; kill the browser context menu on it.
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
   }

   // Called at the top of each frame. No-op today; kept for symmetry with endFrame.
  beginFrame() {}

   // Called at the bottom of each frame: clear the edge-triggered and accumulated
   // values so the next frame starts clean. mouseDX/DY are zero on frames with no
   // movement because nothing adds to them.
  endFrame() {
    this._pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
   }
}
