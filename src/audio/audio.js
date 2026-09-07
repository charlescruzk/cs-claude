// One AudioContext for the whole game, plus a master gain every voice routes through.
// No audio files anywhere: every sound is synthesised in sfx.js from this context.
//
// A context is created 'suspended' — browsers require a user gesture before audio
// can start — so unlock() must be called from inside a real click handler. Until
// then every sound is silently dropped with no error anywhere, which is why the
// overlay's click-to-play handler calls it.
export class Audio {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = Ctx ? new Ctx() : null;
    this.enabled = !!this.ctx;
    this.master = null;
    this._noise = null;
    if (!this.ctx) return;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this._noise = this._makeNoise(1.0);
  }

  // Resume the context. Safe to call repeatedly; must come from a user gesture.
  unlock() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() {
    return this.enabled && this.ctx.state === 'running';
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  // One second of white noise, generated once and shared by every noise-based
  // voice. Generating a buffer per shot would allocate ~200 KB per trigger.
  _makeNoise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
