// HUD, minimap, menu, game-over, pause, and mobile touch controls.

import { CONFIG } from './config.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: document.getElementById('hud'),
      menu: document.getElementById('menu'),
      gameover: document.getElementById('gameover'),
      pause: document.getElementById('pause'),
      crosshair: document.getElementById('crosshair'),
      scope: document.getElementById('scope'),
      healthFill: document.getElementById('health-fill'),
      healthText: document.getElementById('health-text'),
      ammo: document.getElementById('ammo'),
      weaponName: document.getElementById('weapon-name'),
      killFeed: document.getElementById('kill-feed'),
      hitmarker: document.getElementById('hitmarker'),
      hitFlash: document.getElementById('hit-flash'),
      damageVignette: document.getElementById('damage-vignette'),
      objectiveText: document.getElementById('objective-text'),
      infectionCounter: document.getElementById('infection-counter'),
      infectionCount: document.getElementById('infection-count'),
      banner: document.getElementById('banner'),
      bannerTitle: document.getElementById('banner-title'),
      bannerSub: document.getElementById('banner-sub'),
      hideCountdown: document.getElementById('hide-countdown'),
      hideTimer: document.getElementById('hide-timer'),
      scoreVal: document.getElementById('score-val'),
      finalScore: document.getElementById('final-score'),
      finalKills: document.getElementById('final-kills'),
      gameoverTitle: document.getElementById('gameover-title'),
      gameoverReason: document.getElementById('gameover-reason'),
      minimap: document.getElementById('minimap'),
      mobileControls: document.getElementById('mobile-controls'),
      pickupBadge: document.getElementById('pickup-badge'),
      staminaFill: document.getElementById('stamina-fill'),
    };
    this.minimapCtx = this.el.minimap.getContext('2d');
    this.isMobile = window.matchMedia('(pointer: coarse)').matches;

    this._bindButtons();
    this._bindMobile();
    this._bindKeyboard();
  }

  _bindButtons() {
    document.getElementById('btn-start').addEventListener('click', () => this.game.start());
    document.getElementById('btn-restart').addEventListener('click', () => this.game.start());
    document.getElementById('btn-resume').addEventListener('click', () => this.game.togglePause());
    document.getElementById('btn-music').addEventListener('click', (e) => {
      this.game.audio.setMusicEnabled(!this.game.audio.musicEnabled);
      e.target.textContent = 'MUSIC: ' + (this.game.audio.musicEnabled ? 'ON' : 'OFF');
    });
    document.getElementById('btn-sfx').addEventListener('click', (e) => {
      this.game.audio.setSfxEnabled(!this.game.audio.sfxEnabled);
      e.target.textContent = 'SFX: ' + (this.game.audio.sfxEnabled ? 'ON' : 'OFF');
    });
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.game.state === 'playing') this.game.togglePause();
        else if (this.game.state === 'paused') this.game.togglePause();
      }
      if (e.code === 'KeyR' && this.game.state === 'playing') {
        this.game.weapon.startReload();
      }
      if (e.code === 'Space' && this.game.state === 'playing') {
        this.game.input.jumpPressed = true;
      }
      // Weapon switching: 1-6
      if (this.game.state === 'playing') {
        const weaponKeys = this.game.weapon.weaponKeys;
        const numMap = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5 };
        if (e.code in numMap && numMap[e.code] < weaponKeys.length) {
          this.game.weapon.switchTo(weaponKeys[numMap[e.code]]);
        }
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.game.input.jumpPressed = false;
    });
    // Scroll wheel weapon switching
    document.addEventListener('wheel', (e) => {
      if (this.game.state !== 'playing') return;
      this.game.weapon.switchWeapon(e.deltaY > 0 ? 1 : -1);
    });
  }

  _bindMobile() {
    if (!this.isMobile) return;
    this.el.mobileControls.classList.remove('hidden');

    // Joystick
    const joyZone = document.getElementById('joy-zone');
    const joyBase = document.getElementById('joy-base');
    const joyKnob = document.getElementById('joy-knob');
    let joyActive = false;
    let joyId = null;
    const joyCenter = { x: 0, y: 0 };

    const setJoy = (clientX, clientY) => {
      const rect = joyBase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const max = rect.width / 2;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.game.input.joyX = dx / max;
      this.game.input.joyY = -dy / max;
    };

    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyActive = true;
      joyId = t.identifier;
      setJoy(t.clientX, t.clientY);
    }, { passive: false });
    joyZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) setJoy(t.clientX, t.clientY);
      }
    }, { passive: false });
    const endJoy = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyActive = false;
          joyId = null;
          joyKnob.style.transform = 'translate(0,0)';
          this.game.input.joyX = 0;
          this.game.input.joyY = 0;
        }
      }
    };
    joyZone.addEventListener('touchend', endJoy);
    joyZone.addEventListener('touchcancel', endJoy);

    // Look: drag on right side of screen
    const lookZone = document.getElementById('hud');
    let lookActive = false;
    let lastX = 0, lastY = 0;
    lookZone.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.5) {
          lookActive = true;
          lastX = t.clientX;
          lastY = t.clientY;
        }
      }
    }, { passive: true });
    lookZone.addEventListener('touchmove', (e) => {
      if (!lookActive) return;
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.5) {
          this.game.input.mouseDX += (t.clientX - lastX);
          this.game.input.mouseDY += (t.clientY - lastY);
          lastX = t.clientX;
          lastY = t.clientY;
        }
      }
    }, { passive: true });
    lookZone.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.5) lookActive = false;
      }
    });

    // Fire button
    const fireBtn = document.getElementById('btn-fire');
    fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.game.input.firing = true; }, { passive: false });
    fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.game.input.firing = false; }, { passive: false });

    // Jump button
    const jumpBtn = document.getElementById('btn-jump');
    jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.game.input.jumpPressed = true; }, { passive: false });
    jumpBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.game.input.jumpPressed = false; }, { passive: false });

    // Reload button
    const reloadBtn = document.getElementById('btn-reload');
    reloadBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.game.weapon.startReload(); }, { passive: false });
  }

  showMenu() {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
  }

  showHUD() {
    this.el.menu.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  showGameOver(score, kills, reason) {
    this.el.hud.classList.add('hidden');
    this.el.gameover.classList.remove('hidden');
    this.el.finalScore.textContent = 'SCORE: ' + score;
    this.el.finalKills.textContent = 'KILLS: ' + kills;
    if (reason) {
      this.el.gameoverTitle.textContent = 'GAME OVER';
      this.el.gameoverReason.textContent = reason;
      this.el.gameoverReason.classList.remove('hidden');
    } else {
      this.el.gameoverTitle.textContent = 'YOU DIED';
      this.el.gameoverReason.classList.add('hidden');
    }
  }

  showPause() {
    this.el.pause.classList.remove('hidden');
  }

  hidePause() {
    this.el.pause.classList.add('hidden');
  }

  updateHUD(player, weapon, score) {
    const hpPct = Math.max(0, player.health / player.maxHealth * 100);
    this.el.healthFill.style.width = hpPct + '%';
    this.el.healthFill.style.background = hpPct > 50
      ? 'linear-gradient(90deg, #3bff8a, #7dffb0)'
      : hpPct > 25
        ? 'linear-gradient(90deg, #ffd166, #ffb03b)'
        : 'linear-gradient(90deg, #ff3b3b, #ff7d3b)';
    this.el.healthText.textContent = Math.ceil(player.health);
    const ammo = weapon.currentAmmo;
    this.el.ammo.textContent = ammo.mag + ' / ' + ammo.reserve;
    this.el.weaponName.textContent = weapon.current.name;
    this.el.scoreVal.textContent = score;

    // Infection counter
    if (this.game && this.game.bots) {
      this.updateInfection(this.game.bots.infectedCount());
    }

    // Highlight active weapon slot
    const activeKey = weapon.weaponKeys[weapon.currentIndex];
    document.querySelectorAll('.slot').forEach((s) => {
      s.classList.toggle('active', s.dataset.w === activeKey);
      // Hide weapon slots until owned
      s.classList.toggle('hidden', !weapon.owned[s.dataset.w]);
    });

    // Toggle scope overlay when zoomed with sniper
    const isZoomed = weapon.zoomed && weapon.zoomAmount > 0.5;
    this.el.scope.classList.toggle('hidden', !isZoomed);
    this.el.crosshair.classList.toggle('hidden', isZoomed);
  }

  updateInfection(count) {
    this.el.infectionCount.textContent = count;
    this.el.infectionCounter.classList.toggle('hidden', count <= 0);
  }

  updateObjective(text) {
    this.el.objectiveText.textContent = text;
  }

  updateBanner(banner) {
    if (banner) {
      this.el.banner.classList.remove('hidden');
      this.el.bannerTitle.textContent = banner.title;
      this.el.bannerSub.textContent = banner.sub;
    } else {
      this.el.banner.classList.add('hidden');
    }
  }

  showHideCountdown(timeLeft) {
    this.el.hideCountdown.classList.remove('hidden');
    this.el.hideTimer.textContent = Math.ceil(timeLeft);
  }

  hideHideCountdown() {
    this.el.hideCountdown.classList.add('hidden');
  }

  showHitmarker() {
    this.el.hitmarker.classList.remove('hidden');
    // restart animation
    this.el.hitmarker.style.animation = 'none';
    void this.el.hitmarker.offsetWidth;
    this.el.hitmarker.style.animation = '';
    setTimeout(() => this.el.hitmarker.classList.add('hidden'), 250);
  }

  showDamage() {
    // Quick red flash on the edges when hit.
    this.el.hitFlash.classList.remove('hidden');
    this.el.hitFlash.style.animation = 'none';
    void this.el.hitFlash.offsetWidth;
    this.el.hitFlash.style.animation = '';
    setTimeout(() => this.el.hitFlash.classList.add('hidden'), 200);
  }

  // Persistent red tint that intensifies as health drops.
  updateLowHealth(health, maxHealth) {
    const ratio = Math.max(0, health / maxHealth);
    // Tint kicks in below 50% health and grows to full red near death.
    let tint = 0;
    if (ratio < 0.5) {
      tint = (0.5 - ratio) / 0.5; // 0 at 50%, 1 at 0%
    }
    this.el.damageVignette.style.background =
      `radial-gradient(ellipse at center, transparent 45%, rgba(255,0,0,${0.15 + tint * 0.55}) 100%)`;
    this.el.damageVignette.style.opacity = tint > 0 ? '1' : '0';
  }

  addKillFeed(text) {
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.textContent = text;
    this.el.killFeed.appendChild(entry);
    setTimeout(() => entry.remove(), 3000);
  }

  // Flash a badge near the minimap showing what was picked up.
  showPickupBadge(label) {
    this.el.pickupBadge.textContent = label;
    this.el.pickupBadge.classList.remove('hidden');
    // Restart animation
    this.el.pickupBadge.style.animation = 'none';
    void this.el.pickupBadge.offsetWidth;
    this.el.pickupBadge.style.animation = '';
    clearTimeout(this._badgeTimer);
    this._badgeTimer = setTimeout(() => this.el.pickupBadge.classList.add('hidden'), 2000);
  }

  // Update the stamina bar.
  updateStamina(stamina) {
    const pct = Math.max(0, Math.min(100, stamina));
    this.el.staminaFill.style.width = pct + '%';
  }

  drawMinimap(player, bots, world) {
    const ctx = this.minimapCtx;
    const size = this.el.minimap.width;
    ctx.clearRect(0, 0, size, size);
    const scale = size / (CONFIG.worldSize * 2);

    // Buildings
    ctx.fillStyle = 'rgba(120,140,160,0.5)';
    for (const o of world.obstacles) {
      if (o.crate) continue;
      const x = (o.minX + CONFIG.worldSize) * scale;
      const y = (o.minZ + CONFIG.worldSize) * scale;
      const w = (o.maxX - o.minX) * scale;
      const h = (o.maxZ - o.minZ) * scale;
      ctx.fillRect(x, y, w, h);
    }

    // Bots
    for (const bot of bots) {
      if (!bot.alive) continue;
      const x = (bot.pos.x + CONFIG.worldSize) * scale;
      const y = (bot.pos.z + CONFIG.worldSize) * scale;
      // Revealed bots show brighter and larger (spotlight lock).
      if (bot.revealed > 0) {
        ctx.fillStyle = '#ff2d78';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff9db8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,45,120,0.5)';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player
    ctx.fillStyle = '#00e5ff';
    const px = (player.pos.x + CONFIG.worldSize) * scale;
    const py = (player.pos.z + CONFIG.worldSize) * scale;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    // Direction
    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - Math.sin(player.yaw) * 10, py - Math.cos(player.yaw) * 10);
    ctx.stroke();
  }
}
