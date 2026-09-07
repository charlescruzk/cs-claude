import { events } from '../core/events.js';

// Every game sound, synthesised from noise and oscillators. Subscribes to the
// shared event bus so no gameplay module imports audio. Voices are capped so a
// firefight cannot pile up enough nodes to distort the mix.
const MAX_VOICES = 16;
const TINY = 0.001; // exponential ramps cannot target zero

// Gunshots: white noise through a lowpass swept downward, fast attack, exponential
// decay. Bigger gun = louder, longer, darker.
const SHOT = {
  pistol:  { startHz: 3200, endHz: 260, decay: 0.11, gain: 0.35 },
  rifle:   { startHz: 4200, endHz: 200, decay: 0.16, gain: 0.45 },
  shotgun: { startHz: 2200, endHz: 120, decay: 0.28, gain: 0.55 },
  sniper:  { startHz: 5000, endHz: 150, decay: 0.34, gain: 0.60 },
};

export class Sfx {
  constructor(audio) {
    this.audio = audio;
    this.voices = 0;
    events.on('shot', (p) => this.shot(String(p.weapon?.name || 'pistol').toLowerCase()));
    events.on('hit', (p) => { if (p.target === 'player') this.hurt(); else this.hitmark(p.headshot); });
    events.on('kill', (p) => { if (p.victim === 'player') this.die(); });
    events.on('tactical', (e) => { if (e.kind === 'frag') this.explosion(); else this.flashbang(); });
    events.on('reload', () => this.reload());
    events.on('switch', () => this.click(0.08));
    events.on('step', (p) => this.step(p && p.walk));
    events.on('land', (p) => this.land(p ? p.speed : 4));
    events.on('roundState', (s) => { if (s === 'live') this.roundStart(); });
  }

  // --- helpers ---------------------------------------------------------------

  _ok() {
    return this.audio.ready && this.voices < MAX_VOICES;
  }

  // Count a voice for `seconds`, then release the slot.
  _hold(seconds) {
    this.voices++;
    setTimeout(() => { this.voices--; }, seconds * 1000 + 50);
  }

  // Noise burst through a lowpass sweeping startHz → endHz over `decay`.
  _noiseBurst({ startHz, endHz, decay, gain, type = 'lowpass', q = 1, delay = 0 }) {
    if (!this._ok()) return;
    const ctx = this.audio.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.audio._noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(startHz, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(endHz, 20), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(TINY, t + decay);
    src.connect(f); f.connect(g); g.connect(this.audio.master);
    src.start(t);
    src.stop(t + decay + 0.02);
    this._hold(decay + delay);
  }

  // A tone with an exponential pitch/gain envelope.
  _tone({ type = 'sine', startHz, endHz = startHz, decay, gain, delay = 0 }) {
    if (!this._ok()) return;
    const ctx = this.audio.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(startHz, t);
    if (endHz !== startHz) o.frequency.exponentialRampToValueAtTime(Math.max(endHz, 20), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(TINY, t + decay);
    o.connect(g); g.connect(this.audio.master);
    o.start(t);
    o.stop(t + decay + 0.02);
    this._hold(decay + delay);
  }

  // --- voices ----------------------------------------------------------------

  shot(kind) {
    const p = SHOT[kind] || SHOT.pistol;
    this._noiseBurst(p);
    // A low body thump under the crack sells the weight of the bigger guns.
    this._tone({ startHz: 140, endHz: 50, decay: p.decay * 0.8, gain: p.gain * 0.5 });
  }

  hitmark(headshot) {
    this._tone({ type: 'square', startHz: 1800, endHz: 1400, decay: 0.045, gain: 0.12 });
    if (headshot) this._tone({ type: 'square', startHz: 2600, endHz: 2200, decay: 0.06, gain: 0.12, delay: 0.03 });
  }

  hurt() {
    this._noiseBurst({ startHz: 700, endHz: 120, decay: 0.16, gain: 0.30 });
    this._tone({ startHz: 90, endHz: 45, decay: 0.18, gain: 0.25 });
  }

  die() {
    this._tone({ startHz: 220, endHz: 40, decay: 0.9, gain: 0.30 });
    this._noiseBurst({ startHz: 400, endHz: 60, decay: 0.7, gain: 0.25 });
  }

  reload() {
    this.click(0.10, 0);
    this.click(0.14, 0.11);
  }

  // A short filtered tick: magazine, weapon switch, UI.
  click(decay = 0.08, delay = 0) {
    this._noiseBurst({ startHz: 2500, endHz: 900, decay, gain: 0.18, type: 'bandpass', q: 2, delay });
  }

  step(walk) {
    this._noiseBurst({
      startHz: 900 + Math.random() * 200, endHz: 300, decay: 0.06,
      gain: walk ? 0.06 : 0.10, type: 'bandpass', q: 1.2,
    });
  }

  land(speed) {
    const k = Math.min(1, speed / 9);
    this._noiseBurst({ startHz: 600, endHz: 100, decay: 0.10 + 0.08 * k, gain: 0.12 + 0.20 * k });
  }

  explosion() {
    this._noiseBurst({ startHz: 900, endHz: 60, decay: 0.85, gain: 0.7 });
    this._tone({ startHz: 55, endHz: 30, decay: 1.0, gain: 0.5 });
  }

  // A bright crack, then a sustained high ring that fades with the whiteout.
  flashbang() {
    this._noiseBurst({ startHz: 6000, endHz: 800, decay: 0.25, gain: 0.5 });
    this._tone({ startHz: 3600, decay: 2.4, gain: 0.18 });
  }

  roundStart() {
    this._tone({ type: 'triangle', startHz: 660, decay: 0.12, gain: 0.15 });
    this._tone({ type: 'triangle', startHz: 880, decay: 0.18, gain: 0.15, delay: 0.12 });
  }
}
