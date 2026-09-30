// Synthesized audio via Web Audio API — zero audio files.
// Gunshots, impacts, footsteps, pickups, and a simple ambient music loop.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.enabled = true;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this.musicTimer = null;
    this.noiseBuffer = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.25;
    this.musicGain.connect(this.master);

    // Pre-build a noise buffer for percussive sounds.
    const len = this.ctx.sampleRate * 1.0;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.8 : 0;
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.25 : 0;
  }

  setSfxEnabled(on) {
    this.sfxEnabled = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.9 : 0;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // --- helpers ---
  _noise(duration, filterFreq, type = 'lowpass', gain = 1, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  _tone(freq, duration, type = 'sine', gain = 1, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // Music tone — routes to the music bus so it can be toggled independently.
  _musicTone(freq, duration, type = 'sine', gain = 1, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // --- SFX ---
  shoot() {
    if (!this.enabled) return;
    // Punchy gunshot: sharp noise burst + low thump + crack
    this._noise(0.08, 2400, 'lowpass', 0.8);
    this._noise(0.05, 5000, 'highpass', 0.4);
    this._tone(180, 0.12, 'square', 0.3, 0, 50);
    this._tone(900, 0.04, 'sawtooth', 0.15, 0, 300);
  }

  sniperShot() {
    if (!this.enabled) return;
    // Big rifle blast: loud crack + deep boom + long tail
    this._noise(0.18, 3200, 'lowpass', 1.0);
    this._noise(0.12, 6000, 'highpass', 0.5);
    this._tone(120, 0.3, 'sine', 0.7, 0, 35);
    this._tone(60, 0.4, 'sine', 0.5, 0.02, 25);
    this._tone(1400, 0.05, 'sawtooth', 0.2, 0, 500);
    // Echo tail
    this._noise(0.4, 900, 'lowpass', 0.3, 0.15);
  }

  shotgunShot() {
    if (!this.enabled) return;
    this._noise(0.2, 2000, 'lowpass', 1.0);
    this._tone(100, 0.25, 'sine', 0.6, 0, 30);
    this._noise(0.3, 700, 'lowpass', 0.3, 0.1);
  }

  melee() {
    if (!this.enabled) return;
    // Whoosh + impact
    this._noise(0.12, 1200, 'bandpass', 0.4);
    this._tone(300, 0.08, 'sawtooth', 0.2, 0, 150);
  }

  reload() {
    if (!this.enabled) return;
    this._noise(0.05, 3000, 'highpass', 0.3);
    this._tone(600, 0.06, 'square', 0.15, 0.1, 400);
    this._tone(900, 0.06, 'square', 0.15, 0.25, 500);
  }

  empty() {
    if (!this.enabled) return;
    this._tone(1200, 0.04, 'square', 0.2);
  }

  hit() {
    if (!this.enabled) return;
    this._tone(900, 0.06, 'triangle', 0.3, 0, 500);
  }

  kill() {
    if (!this.enabled) return;
    this._tone(500, 0.2, 'sawtooth', 0.3, 0, 80);
    this._noise(0.2, 800, 'lowpass', 0.4);
  }

  explosion() {
    if (!this.enabled) return;
    this._noise(0.5, 400, 'lowpass', 0.9);
    this._tone(80, 0.4, 'sine', 0.6, 0, 30);
  }

  hurt() {
    if (!this.enabled) return;
    this._tone(200, 0.15, 'sawtooth', 0.3, 0, 90);
  }

  pickup() {
    if (!this.enabled) return;
    this._tone(660, 0.08, 'sine', 0.3);
    this._tone(990, 0.1, 'sine', 0.3, 0.08);
  }

  footstep() {
    if (!this.enabled) return;
    this._noise(0.05, 500, 'lowpass', 0.12);
  }

  // --- Music: a peaceful, calm ambient loop ---
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    // A gentle pentatonic progression (C major pentatonic) — calm and airy.
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C D E G A C5
    const playBar = () => {
      if (!this.musicEnabled) return;
      // Slow, soft pad chord
      const root = scale[Math.floor(Math.random() * 3)]; // pick a low-ish root
      const chord = [root, root * 1.25, root * 1.5];
      chord.forEach((f, i) => {
        this._musicTone(f, 4.0, 'sine', 0.08, i * 0.1);
        this._musicTone(f * 2, 4.0, 'triangle', 0.03, i * 0.1);
      });
      // A sparse, gentle melody note
      const melody = scale[Math.floor(Math.random() * scale.length)];
      this._musicTone(melody * 2, 1.8, 'sine', 0.05, 0.4);
      // Soft low bass pulse
      this._musicTone(root / 2, 1.2, 'sine', 0.06, 0);
    };
    playBar();
    this.musicTimer = setInterval(playBar, 4000);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
