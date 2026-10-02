// Synthesized audio via Web Audio API — zero audio files.
// Features dynamic tension/pursuit horror music, binaural sub-drones, and punchy SFX.

import { CONFIG } from './config.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.enabled = true;
    this.musicEnabled = true;
    this.sfxEnabled = true;

    // Music System State
    this.musicTimer = null;
    this.threatLevel = 0; // 0 = Calm stealth drone, 1 = Full horror pursuit
    this.heartbeatTimer = null;
    this.droneOscs = [];
    this.noiseBuffer = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.master);

    // Pre-build 2-second white noise buffer for percussive hits
    const len = this.ctx.sampleRate * 2.0;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.85 : 0;
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.35 : 0;
  }

  setSfxEnabled(on) {
    this.sfxEnabled = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.9 : 0;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // --- Dynamic Threat Level Control ---
  // Call this in main.js based on distance to nearest pursuing bot (0.0 to 1.0)
  setThreatLevel(val) {
    this.threatLevel = Math.max(0, Math.min(1, val));
  }

  // --- Audio Synthesis Primitives ---
  _noise(duration, filterFreq, type = 'lowpass', gain = 1, when = 0) {
    if (!this.ctx || !this.sfxEnabled) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  _tone(freq, duration, type = 'sine', gain = 1, when = 0, slideTo = null) {
    if (!this.ctx || !this.sfxEnabled) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  _musicTone(freq, duration, type = 'sine', gain = 1, when = 0, slideTo = null) {
    if (!this.ctx || !this.musicEnabled) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // --- Dynamic Horror & Pursuit Music Engine ---
  startMusic() {
    if (!this.ctx || this.musicTimer) return;

    // Atmospheric tension: Low, sinister drones with detuned intervals
    const playBar = () => {
      if (!this.musicEnabled) return;

      const isChased = this.threatLevel > 0.45;

      if (!isChased) {
        // TENSE STEALTH DRONE: Low C (55Hz) & detuned Gb tritone (77.7Hz)
        this._musicTone(55, 3.8, 'sawtooth', 0.04, 0, 54.5);
        this._musicTone(55.4, 3.8, 'sine', 0.08, 0.05);
        this._musicTone(77.78, 3.2, 'triangle', 0.03, 0.2); // Tritone devil's chord

        // Occasional metallic shiver
        if (Math.random() > 0.4) {
          const highNotes = [440, 466.16, 622.25]; // A4, Bb4, Eb5
          const n = highNotes[Math.floor(Math.random() * highNotes.length)];
          this._musicTone(n, 2.0, 'sine', 0.02, 0.5, n * 0.98);
        }
      } else {
        // PANIC PURSUIT HORROR: Agitated screeching strings + pounding pulse
        const baseRoot = 65.41; // C2

        // Fast alternating stabbing dissonant stabs
        for (let i = 0; i < 4; i++) {
          const timeOffset = i * 0.45;
          // Aggressive dissonant clusters (C + C#)
          this._musicTone(baseRoot * 8, 0.25, 'sawtooth', 0.08 * this.threatLevel, timeOffset, baseRoot * 7.5);
          this._musicTone((baseRoot * 8) * 1.059, 0.25, 'sawtooth', 0.07 * this.threatLevel, timeOffset);

          // Sub-drop thud (thumping adrenaline heartbeat)
          this._musicTone(90, 0.15, 'sine', 0.18 * this.threatLevel, timeOffset, 32);
        }

        // Noise screech
        if (Math.random() > 0.5) {
          this._noise(0.6, 1800, 'bandpass', 0.15 * this.threatLevel, 0.2);
        }
      }
    };

    playBar();
    this.musicTimer = setInterval(playBar, 1800);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  // --- Sound Effects ---

  // Silent stealth melee / knife takedown
  stealthStab() {
    if (!this.enabled) return;
    this._noise(0.08, 1400, 'bandpass', 0.4);
    this._tone(220, 0.12, 'sawtooth', 0.25, 0, 80);
    this._noise(0.15, 600, 'lowpass', 0.35, 0.04);
  }

  // Tagging an NPC target
  tagPing(isCorrect = false) {
    if (!this.enabled) return;
    if (isCorrect) {
      this._tone(880, 0.08, 'sine', 0.25);
      this._tone(1760, 0.14, 'sine', 0.3, 0.07);
    } else {
      this._tone(440, 0.12, 'triangle', 0.2);
      this._tone(370, 0.16, 'triangle', 0.22, 0.08);
    }
  }

  shoot() {
    if (!this.enabled) return;
    this._noise(0.09, 2800, 'lowpass', 0.85);
    this._noise(0.05, 5500, 'highpass', 0.45);
    this._tone(180, 0.12, 'square', 0.35, 0, 45);
    this._tone(90, 0.18, 'sine', 0.5, 0, 30);
  }

  sniperShot() {
    if (!this.enabled) return;
    this._noise(0.22, 3400, 'lowpass', 1.0);
    this._noise(0.14, 6500, 'highpass', 0.6);
    this._tone(140, 0.35, 'sine', 0.85, 0, 30);
    this._tone(65, 0.45, 'sine', 0.7, 0.02, 22);
    this._noise(0.45, 800, 'lowpass', 0.35, 0.15);
  }

  shotgunShot() {
    if (!this.enabled) return;
    this._noise(0.25, 2200, 'lowpass', 1.0);
    this._tone(110, 0.3, 'sine', 0.75, 0, 25);
    this._noise(0.35, 650, 'lowpass', 0.4, 0.08);
  }

  melee() {
    if (!this.enabled) return;
    this._noise(0.1, 1400, 'bandpass', 0.35);
    this._tone(260, 0.08, 'sawtooth', 0.2, 0, 130);
  }

  reload() {
    if (!this.enabled) return;
    this._noise(0.05, 3200, 'highpass', 0.25);
    this._tone(550, 0.06, 'square', 0.12, 0.1, 380);
    this._tone(850, 0.06, 'square', 0.12, 0.24, 480);
  }

  empty() {
    if (!this.enabled) return;
    this._tone(1400, 0.03, 'square', 0.2);
  }

  hit() {
    if (!this.enabled) return;
    this._tone(950, 0.05, 'triangle', 0.35, 0, 550);
  }

  kill() {
    if (!this.enabled) return;
    this._tone(450, 0.22, 'sawtooth', 0.3, 0, 60);
    this._noise(0.2, 700, 'lowpass', 0.45);
  }

  explosion() {
    if (!this.enabled) return;
    this._noise(0.65, 450, 'lowpass', 1.0);
    this._tone(90, 0.5, 'sine', 0.8, 0, 25);
  }

  hurt() {
    if (!this.enabled) return;
    this._tone(180, 0.18, 'sawtooth', 0.35, 0, 70);
  }

  pickup() {
    if (!this.enabled) return;
    this._tone(700, 0.08, 'sine', 0.25);
    this._tone(1050, 0.1, 'sine', 0.28, 0.07);
  }

  footstep(isSprinting = false) {
    if (!this.enabled) return;
    if (isSprinting) {
      // Hard, rapid foot slap
      this._noise(0.07, 750, 'lowpass', 0.24);
      this._tone(110, 0.06, 'sine', 0.18, 0, 50);
    } else {
      // Soft, subtle brush
      this._noise(0.04, 450, 'lowpass', 0.08);
    }
  }

  // --- Non-lethal shove / environmental SFX ---

  // Infected hiss when their disguise is broken by a shove.
  hiss() {
    if (!this.enabled) return;
    this._noise(0.35, 3200, 'bandpass', 0.5);
    this._tone(1400, 0.3, 'sawtooth', 0.15, 0, 2200);
    this._tone(90, 0.25, 'sine', 0.3, 0.05, 45);
  }

  // Angry civilian voice bark when shoved.
  grunt() {
    if (!this.enabled) return;
    this._tone(180, 0.16, 'sawtooth', 0.3, 0, 120);
    this._tone(240, 0.12, 'sawtooth', 0.22, 0.12, 160);
  }

  // Whiff sound when a shove misses.
  swing() {
    if (!this.enabled) return;
    this._noise(0.12, 900, 'bandpass', 0.25);
  }

  // Wooden stair creak (sharp, woody).
  creak() {
    if (!this.enabled) return;
    this._tone(320, 0.18, 'sawtooth', 0.18, 0, 180);
    this._noise(0.12, 500, 'lowpass', 0.2);
  }

  // Car alarm / trash can clang — loud metallic alarm.
  alarm() {
    if (!this.enabled) return;
    for (let i = 0; i < 3; i++) {
      const t = i * 0.35;
      this._tone(880, 0.22, 'square', 0.35, t);
      this._tone(660, 0.22, 'square', 0.3, t + 0.18);
    }
    this._noise(0.5, 2400, 'bandpass', 0.4);
  }

  // Muffled rhythmic thud below (hunter on the ground floor).
  thud() {
    if (!this.enabled) return;
    this._tone(70, 0.2, 'sine', 0.5, 0, 40);
    this._tone(55, 0.25, 'sine', 0.4, 0.3, 32);
  }

  // Low binaural phase-shifted hum when near Patient Zero.
  whisper(proximity = 1) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = CONFIG.whisper.volume * Math.max(0, Math.min(1, proximity));
    // Two detuned sub-bass oscillators panned L/R for a binaural beating effect.
    const oscL = this.ctx.createOscillator();
    oscL.type = 'sine';
    oscL.frequency.value = 55;
    const oscR = this.ctx.createOscillator();
    oscR.type = 'sine';
    oscR.frequency.value = 55.8; // ~0.8Hz beating
    const gL = this.ctx.createGain();
    gL.gain.setValueAtTime(vol, t);
    gL.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    const gR = this.ctx.createGain();
    gR.gain.setValueAtTime(vol, t);
    gR.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    const panL = this.ctx.createStereoPanner();
    panL.pan.value = -0.7;
    const panR = this.ctx.createStereoPanner();
    panR.pan.value = 0.7;
    oscL.connect(gL).connect(panL).connect(this.sfxGain);
    oscR.connect(gR).connect(panR).connect(this.sfxGain);
    oscL.start(t);
    oscR.start(t);
    oscL.stop(t + 1.3);
    oscR.stop(t + 1.3);
  }
}
