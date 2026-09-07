// Per-frame input. Holds the set of currently-pressed keys, the mouse movement
// accumulated since the last frame, and the state of the three mouse buttons.
// Pointer lock is requested on a canvas/overlay click so the mouse becomes
// relative movement. beginFrame/endFrame reset the per-frame values.

// A real flick is well under this many pixels in one event. Anything larger is an
// OS artefact — a pointer-lock transition, a focus change, a display switch — not a
// player turning, and applying it snaps the view a full turn.
const MAX_MOVE = 180;
// Events to discard right after the lock engages: Chrome's first mousemove after
// requestPointerLock can carry the jump from the old cursor position.
const LOCK_SETTLE = 2;

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
    this._settle = 0; // mousemove events still to discard after a fresh lock
    this._onLockChange = null;              // callback(locked), set by main.js
    this._onLockError = null;                   // callback(msg), set by main.js
    this._bind();
   }

   // True only on the frame a key transitioned from up to down.
  justPressed(code) {
    return this._pressed.has(code);
   }

  requestLock() {
     // requestPointerLock can refuse the lock (a browser setting, an embedded or
     // inactive document, or Chrome's ~1 s cooldown after an Esc exit) and fail
     // silently. Catch both the synchronous throw and the promise rejection so the
     // failure is reported instead of leaving the game permanently dead.
    let p;
    try {
      p = this.canvas.requestPointerLock();
     } catch (err) {
      if (this._onLockError) this._onLockError(err.message);
      return;
     }
     // Chrome returns a promise; Safari/older Chrome return undefined.
    if (p && p.catch) p.catch((err) => {
      if (this._onLockError) this._onLockError(err.name + ': ' + err.message);
     });
   }

  _bind() {
    window.addEventListener('keydown', (e) => {
       // Typing into a field (the multiplayer room code) must not fire game
       // actions: this listener is on window, so every keystroke would otherwise
       // switch weapons, jump, or be swallowed by the Tab/Space preventDefault.
       // keyup is left alone — a leaked one only clears a code from the held set.
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
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
      if (!this.locked) return;
      // Discard the first events after a lock: the first one carries the jump from
      // the old cursor position and would snap the view.
      if (this._settle > 0) { this._settle -= 1; return; }
      const dx = e.movementX;
      const dy = e.movementY;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (Math.abs(dx) > MAX_MOVE || Math.abs(dy) > MAX_MOVE) return; // OS artefact
      this.mouseDX += dx;
      this.mouseDY += dy;
     });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this._settle = LOCK_SETTLE;
      if (this._onLockChange) this._onLockChange(this.locked);
     });
      // A refused lock must not die silently: the whole game is gated on pointer
      // lock, so surface the failure the same way index.html surfaces boot errors.
    document.addEventListener('pointerlockerror', () => {
      if (this._onLockError) this._onLockError('pointerlockerror (browser refused the lock)');
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
