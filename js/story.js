// Wave system — Call of Duty Zombies style.
// Waves of enemies get progressively harder. When all enemies in a wave are
// killed, the player gets a "refresh" phase to collect pickups before the next wave.

import { CONFIG } from './config.js';

export class Story {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.waveState = 'intermission'; // intermission | active | complete
    this.waveKills = 0;
    this.waveTarget = 0;
    this.intermissionTimer = 0;
    this.bannerTimer = 0;
    this.bannerText = '';
    this.bannerSub = '';
  }

  start() {
    this.wave = 0;
    this.waveState = 'intermission';
    this.waveKills = 0;
    this.waveTarget = 0;
    this.intermissionTimer = 0;
    this._startIntermission();
  }

  // Calculate how many enemies spawn for a given wave (gets harder each wave).
  _waveEnemyCount(wave) {
    // Wave 1: 4, then grows ~40% each wave, capped at 100
    return Math.min(100, Math.floor(4 * Math.pow(1.4, wave - 1)));
  }

  _startIntermission() {
    this.waveState = 'intermission';
    this.intermissionTimer = 12; // time to collect pickups before next wave
    if (this.wave === 0) {
      this._showBanner('WAVE 1', 'The horde approaches. Find cover and prepare.');
    } else {
      this._showBanner(`WAVE ${this.wave} CLEARED`, 'Collect supplies. The next wave is coming...');
    }
  }

  _startWave() {
    this.wave++;
    this.waveState = 'active';
    this.waveKills = 0;
    this.waveTarget = this._waveEnemyCount(this.wave);
    this._showBanner(`WAVE ${this.wave}`, `${this.waveTarget} enemies incoming. Survive!`);
    // Spawn the wave's enemies
    this.game.bots.spawnWave(this.waveTarget);
    // On wave 1, seed the infection ("the other" blends in among the NPCs)
    if (this.wave === 1) {
      this.game.bots.setupInfection(this.game.player);
    }
  }

  // Called when the player kills a bot.
  onKill() {
    if (this.waveState !== 'active') return;
    this.waveKills++;
    if (this.waveKills >= this.waveTarget) {
      this._completeWave();
    }
  }

  _completeWave() {
    this.waveState = 'complete';
    this._startIntermission();
  }

  _showBanner(title, sub) {
    this.bannerText = title;
    this.bannerSub = sub;
    this.bannerTimer = 4.0;
  }

  update(dt) {
    if (this.bannerTimer > 0) this.bannerTimer -= dt;

    if (this.waveState === 'intermission') {
      this.intermissionTimer -= dt;
      if (this.intermissionTimer <= 0) {
        this._startWave();
      }
    }
  }

  getObjectiveText() {
    if (this.waveState === 'intermission') {
      return `Next wave in ${Math.ceil(this.intermissionTimer)}s`;
    }
    return `Wave ${this.wave}: ${this.waveKills}/${this.waveTarget}`;
  }

  getBanner() {
    if (this.bannerTimer <= 0) return null;
    return { title: this.bannerText, sub: this.bannerSub };
  }
}
