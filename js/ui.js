// HUD, minimap, menu, game-over, pause, and mobile touch controls.

import { CONFIG } from './config.js?v=20261002d';
import { ACTION_NAMES, keyLabel } from './keybinds.js?v=20261002d';

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
      npcCounter: document.getElementById('npc-counter'),
      npcCount: document.getElementById('npc-count'),
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
      finalTime: document.getElementById('final-time'),
      finalPlaytime: document.getElementById('final-playtime'),
      bestScore: document.getElementById('best-score'),
      bestKills: document.getElementById('best-kills'),
      bestTime: document.getElementById('best-time'),
      highscoreEntry: document.getElementById('highscore-entry'),
      initialsInput: document.getElementById('initials-input'),
      btnSaveScore: document.getElementById('btn-save-score'),
      highscoreList: document.getElementById('highscore-list'),
      highscoreItems: document.getElementById('highscore-items'),
      gameoverTitle: document.getElementById('gameover-title'),
      gameoverReason: document.getElementById('gameover-reason'),
      minimap: document.getElementById('minimap'),
      mobileControls: document.getElementById('mobile-controls'),
      pickupBadge: document.getElementById('pickup-badge'),
      staminaFill: document.getElementById('stamina-fill'),
      options: document.getElementById('options'),
      optNpcs: document.getElementById('opt-npcs'),
      optNpcsVal: document.getElementById('opt-npcs-val'),
      optAggression: document.getElementById('opt-aggression'),
      keybinds: document.getElementById('keybinds'),
      kbList: document.getElementById('kb-list'),
      btnKbReset: document.getElementById('btn-kb-reset'),
      btnKbBack: document.getElementById('btn-kb-back'),
      lobby: document.getElementById('lobby'),
      lobbyTitle: document.getElementById('lobby-title'),
      lobbyHost: document.getElementById('lobby-host'),
      lobbyJoin: document.getElementById('lobby-join'),
      roomCode: document.getElementById('room-code'),
      lobbyStatus: document.getElementById('lobby-status'),
      lobbyCodeInput: document.getElementById('lobby-code-input'),
    };
    this.minimapCtx = this.el.minimap.getContext('2d');
    this.isMobile = window.matchMedia('(pointer: coarse)').matches;

    // Cache static DOM elements to eliminate 60 FPS query thrashing
    this.weaponSlots = Array.from(document.querySelectorAll('.slot'));

    this._bindButtons();
    this._bindMobile();
    this._bindKeyboard();
  }

  _bindButtons() {
    document.getElementById('btn-start').addEventListener('click', () => this.game.start('solo'));
    document.getElementById('btn-restart').addEventListener('click', () => this.game.start(this.game.gameMode || 'solo'));
    document.getElementById('btn-resume').addEventListener('click', () => this.game.togglePause());
    // Mode selection
    document.getElementById('btn-mode-ai').addEventListener('click', () => this.game.start('ai_duel'));
    document.getElementById('btn-mode-pvp').addEventListener('click', () => this.showLobby('pvp_duel'));
    document.getElementById('btn-mode-coop').addEventListener('click', () => this.showLobby('coop'));
    // Lobby
    document.getElementById('btn-lobby-back').addEventListener('click', () => {
      this.game.network.close();
      this.showMenu();
    });
    document.getElementById('btn-lobby-join').addEventListener('click', () => {
      const code = document.getElementById('lobby-code-input').value.trim().toUpperCase();
      if (code.length === 4) {
        this.game.joinRoom(this._lobbyMode, code).catch((err) => {
          this.setLobbyStatus('Join failed: ' + (err.message || 'unknown error'));
        });
      } else {
        this.setLobbyStatus('Enter a 4-letter code');
      }
    });
    // Pause menu: options + exit to menu
    document.getElementById('btn-pause-options').addEventListener('click', () => {
      this.game.state = 'paused';
      this.showOptions();
    });
    document.getElementById('btn-pause-exit').addEventListener('click', () => {
      this.game.state = 'menu';
      this.game.audio.stopMusic();
      document.exitPointerLock();
      this.showMenu();
    });
    document.getElementById('btn-music').addEventListener('click', (e) => {
      this.game.audio.setMusicEnabled(!this.game.audio.musicEnabled);
      e.target.textContent = 'MUSIC: ' + (this.game.audio.musicEnabled ? 'ON' : 'OFF');
    });
    document.getElementById('btn-sfx').addEventListener('click', (e) => {
      this.game.audio.setSfxEnabled(!this.game.audio.sfxEnabled);
      e.target.textContent = 'SFX: ' + (this.game.audio.sfxEnabled ? 'ON' : 'OFF');
    });
    // Options screen
    document.getElementById('btn-options').addEventListener('click', () => this.showOptions());
    document.getElementById('btn-options-back').addEventListener('click', () => {
      // If we came from the pause menu, return there; otherwise main menu.
      if (this.game.state === 'paused') this.showPause();
      else this.showMenu();
    });
    // Keybinds screen
    document.getElementById('btn-keybinds').addEventListener('click', () => this.showKeybinds());
    this.el.btnKbBack.addEventListener('click', () => {
      if (this.game.state === 'paused') this.showPause();
      else this.showOptions();
    });
    this.el.btnKbReset.addEventListener('click', () => {
      this.game.keybinds.reset();
      this._renderKeybinds();
    });
    // Starting NPC slider
    this.el.optNpcs.addEventListener('input', () => {
      const val = parseInt(this.el.optNpcs.value, 10);
      this.el.optNpcsVal.textContent = val;
      this.game.startingNPCs = val;
    });
    // Infection aggression select
    this.el.optAggression.addEventListener('change', () => {
      CONFIG.infection.aggression = this.el.optAggression.value;
    });
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const kb = this.game.keybinds;
      // Pause / resume
      if (e.code === kb.get('pause')) {
        if (this.game.state === 'playing') this.game.togglePause();
        else if (this.game.state === 'paused') this.game.togglePause();
      }
      // Reload
      if (e.code === kb.get('reload') && this.game.state === 'playing') {
        this.game.weapon.startReload();
      }
      // Jump
      if (e.code === kb.get('jump') && this.game.state === 'playing') {
        this.game.input.jumpPressed = true;
      }
      // Tag / Mark Suspect
      if (e.code === kb.get('tag') && this.game.state === 'playing') {
        if (this.game.tagCurrentTarget) this.game.tagCurrentTarget();
      }
      // Interact (fuse boxes, cars, trash cans)
      if (e.code === kb.get('interact') && this.game.state === 'playing') {
        if (this.game.interact) this.game.interact();
      }
      // Weapon switching: bound slots 1-6
      if (this.game.state === 'playing') {
        const weaponKeys = this.game.weapon.weaponKeys;
        for (let i = 0; i < 6; i++) {
          if (e.code === kb.get('weapon' + (i + 1)) && i < weaponKeys.length) {
            this.game.weapon.switchTo(weaponKeys[i]);
          }
        }
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === this.game.keybinds.get('jump')) this.game.input.jumpPressed = false;
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
    this.el.options.classList.add('hidden');
    this.el.keybinds.classList.add('hidden');
    this.el.lobby.classList.add('hidden');
    this.el.hud.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
  }

  showOptions() {
    this.el.menu.classList.add('hidden');
    this.el.options.classList.remove('hidden');
    this.el.keybinds.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    // Sync the controls to the current values.
    this.el.optNpcs.value = this.game.startingNPCs;
    this.el.optNpcsVal.textContent = this.game.startingNPCs;
    this.el.optAggression.value = CONFIG.infection.aggression;
  }

  showKeybinds() {
    this.el.options.classList.add('hidden');
    this.el.keybinds.classList.remove('hidden');
    this._renderKeybinds();
  }

  // --- Multiplayer lobby ---

  // Show the lobby for a multiplayer mode. Offers Host or Join.
  showLobby(mode) {
    this._lobbyMode = mode;
    this.el.menu.classList.add('hidden');
    this.el.lobby.classList.remove('hidden');
    this.el.lobbyTitle.textContent = mode === 'pvp_duel' ? '1V1 VS FRIEND' : '2-PLAYER CO-OP';
    // Show both host + join options.
    this.el.lobbyHost.classList.remove('hidden');
    this.el.lobbyJoin.classList.remove('hidden');
    this.el.roomCode.textContent = '----';
    this.el.lobbyStatus.textContent = 'Host a room or enter a code to join.';
    this.el.lobbyCodeInput.value = '';
    // Host button: create a room immediately.
    this._bindLobbyHost();
  }

  _bindLobbyHost() {
    // Re-bind the host action (idempotent — replaces any previous).
    const hostBtn = document.getElementById('btn-lobby-host');
    if (!hostBtn) {
      // Create the host button dynamically if missing.
      const btn = document.createElement('button');
      btn.id = 'btn-lobby-host';
      btn.textContent = 'HOST ROOM';
      this.el.lobbyHost.appendChild(btn);
    }
    document.getElementById('btn-lobby-host').onclick = () => {
      this.el.lobbyJoin.classList.add('hidden');
      this.el.lobbyStatus.textContent = 'Creating room...';
      this.game.hostRoom(this._lobbyMode).catch((err) => {
        this.setLobbyStatus('Host failed: ' + (err.message || 'unknown error'));
      });
    };
  }

  // Show the host view with the room code.
  showLobbyHost(code) {
    this.el.lobbyHost.classList.remove('hidden');
    this.el.lobbyJoin.classList.add('hidden');
    this.el.roomCode.textContent = code;
    this.el.lobbyStatus.textContent = 'Waiting for player to join...';
  }

  // Show the join view.
  showLobbyJoin() {
    this.el.lobbyHost.classList.add('hidden');
    this.el.lobbyJoin.classList.remove('hidden');
    this.el.lobbyStatus.textContent = 'Enter the host\'s room code:';
  }

  setLobbyStatus(text) {
    this.el.lobbyStatus.textContent = text;
  }

  // Render the list of actions + their bound keys.
  _renderKeybinds() {
    const kb = this.game.keybinds;
    this.el.kbList.innerHTML = '';
    for (const [action, name] of Object.entries(ACTION_NAMES)) {
      const row = document.createElement('div');
      row.className = 'kb-row';

      const label = document.createElement('span');
      label.className = 'kb-action';
      label.textContent = name;

      const btn = document.createElement('button');
      btn.className = 'kb-key';
      btn.dataset.action = action;
      btn.textContent = keyLabel(kb.get(action));
      btn.addEventListener('click', () => this._startListening(action, btn));

      row.appendChild(label);
      row.appendChild(btn);
      this.el.kbList.appendChild(row);
    }
  }

  // Put a binding button into "listening" mode — the next key press remaps it.
  _startListening(action, btn) {
    // Cancel any other listening button.
    document.querySelectorAll('.kb-key.listening').forEach((b) => {
      b.classList.remove('listening');
      b.textContent = keyLabel(this.game.keybinds.get(b.dataset.action));
    });

    btn.classList.add('listening');
    btn.textContent = 'PRESS KEY...';

    const kb = this.game.keybinds;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.removeEventListener('keydown', onKey, true);

      // ESC cancels the remap.
      if (e.code === 'Escape') {
        btn.classList.remove('listening');
        btn.textContent = keyLabel(kb.get(action));
        return;
      }

      // Don't allow binding to a modifier alone.
      if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
        btn.textContent = 'USE A KEY';
        setTimeout(() => {
          btn.classList.remove('listening');
          btn.textContent = keyLabel(kb.get(action));
        }, 600);
        return;
      }

      // Check for conflicts with other actions.
      const conflict = kb.actionFor(e.code);
      if (conflict && conflict !== action) {
        // Swap: give the conflicting action the old key of this action.
        const oldKey = kb.get(action);
        kb.set(conflict, oldKey);
        btn.classList.add('conflict');
        setTimeout(() => btn.classList.remove('conflict'), 800);
      }

      kb.set(action, e.code);
      btn.classList.remove('listening');
      btn.textContent = keyLabel(e.code);
      this._renderKeybinds(); // refresh all rows so swaps show
    };
    document.addEventListener('keydown', onKey, true);
  }

  showHUD() {
    this.el.menu.classList.add('hidden');
    this.el.options.classList.add('hidden');
    this.el.keybinds.classList.add('hidden');
    this.el.lobby.classList.add('hidden');
    this.el.gameover.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
  }

  showGameOver(score, kills, reason, gameTimeSurvived, playerTime) {
    score = Math.floor(score);
    this.el.hud.classList.add('hidden');
    this.el.gameover.classList.remove('hidden');
    this.el.finalScore.textContent = 'SCORE: ' + score;
    this.el.finalKills.textContent = 'KILLS: ' + kills;

    // Two times: game time survived (sun rotations) + real player time.
    const days = Math.floor((gameTimeSurvived || 0) / (CONFIG.dayNight.cycleMinutes * 60));
    this.el.finalTime.textContent = 'TIME SURVIVED: ' + days + ' day' + (days === 1 ? '' : 's');
    this.el.finalPlaytime.textContent = 'PLAY TIME: ' + this._fmtTime(playerTime || 0);

    // Persist best score / kills / time across sessions (localStorage).
    const best = this._loadBests();
    if (score > best.score) best.score = score;
    if (kills > best.kills) best.kills = kills;
    if ((gameTimeSurvived || 0) > best.time) best.time = gameTimeSurvived || 0;
    this._saveBests(best);
    const bestDays = Math.floor((best.time || 0) / (CONFIG.dayNight.cycleMinutes * 60));
    this.el.bestScore.textContent = 'BEST SCORE: ' + best.score;
    this.el.bestKills.textContent = 'BEST KILLS: ' + best.kills;
    this.el.bestTime.textContent = 'BEST TIME: ' + bestDays + ' day' + (bestDays === 1 ? '' : 's');

    // High score entry + list.
    this._showHighScores(score);

    if (reason) {
      this.el.gameoverTitle.textContent = 'GAME OVER';
      this.el.gameoverReason.textContent = reason;
      this.el.gameoverReason.classList.remove('hidden');
    } else {
      this.el.gameoverTitle.textContent = 'YOU DIED';
      this.el.gameoverReason.classList.add('hidden');
    }
  }

  // Load persisted best stats (score / kills / time).
  // Scores are always whole points, so legacy fractional values are floored.
  _loadBests() {
    try {
      const raw = localStorage.getItem('neonstrike_bests');
      const best = raw ? JSON.parse(raw) : { score: 0, kills: 0, time: 0 };
      best.score = Math.floor(best.score || 0);
      best.kills = Math.floor(best.kills || 0);
      return best;
    } catch (e) {
      return { score: 0, kills: 0, time: 0 };
    }
  }

  _saveBests(best) {
    try {
      localStorage.setItem('neonstrike_bests', JSON.stringify(best));
    } catch (e) { /* ignore */ }
  }

  // Format seconds as M:SS.
  _fmtTime(secs) {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  // Load high scores from localStorage (top 5 by score).
  // Scores are always whole points, so legacy fractional values are floored.
  _loadHighScores() {
    try {
      const raw = localStorage.getItem('neonstrike_highscores');
      const list = raw ? JSON.parse(raw) : [];
      return list.map((e) => ({ ...e, score: Math.floor(e.score || 0) }));
    } catch (e) {
      return [];
    }
  }

  _saveHighScores(list) {
    try {
      localStorage.setItem('neonstrike_highscores', JSON.stringify(list.slice(0, 5)));
    } catch (e) { /* storage unavailable — ignore */ }
  }

  // Show the high score list; if the current score qualifies, prompt for initials.
  _showHighScores(score) {
    score = Math.floor(score);
    const list = this._loadHighScores();
    const qualifies = score > 0 && (list.length < 5 || score > list[list.length - 1].score);

    this.el.highscoreEntry.classList.toggle('hidden', !qualifies);
    this.el.highscoreList.classList.remove('hidden');
    this.el.highscoreItems.innerHTML = '';

    // Render the list; highlight the new entry once saved.
    const render = () => {
      this.el.highscoreItems.innerHTML = '';
      list.forEach((entry, i) => {
        const li = document.createElement('li');
        if (entry.isNew) li.classList.add('hs-new');
        li.innerHTML = '<span class="hs-rank">' + (i + 1) + '.</span>' +
          '<span class="hs-initials">' + this._esc(entry.initials) + '</span>' +
          '<span class="hs-score">' + entry.score + '</span>';
        this.el.highscoreItems.appendChild(li);
      });
    };
    render();

    if (qualifies) {
      this.el.initialsInput.value = '';
      this.el.initialsInput.focus();
      // Save on button click or Enter.
      const save = () => {
        const initials = (this.el.initialsInput.value || 'AAA').toUpperCase().slice(0, 3);
        list.push({ initials, score, isNew: true });
        list.sort((a, b) => b.score - a.score);
        // Only the newest entry stays highlighted.
        list.forEach((e) => { e.isNew = e.initials === initials && e.score === score; });
        this._saveHighScores(list);
        this.el.highscoreEntry.classList.add('hidden');
        render();
      };
      this.el.btnSaveScore.onclick = save;
      this.el.initialsInput.onkeydown = (e) => {
        if (e.key === 'Enter') save();
      };
    } else {
      this.el.btnSaveScore.onclick = null;
      this.el.initialsInput.onkeydown = null;
    }
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  showPause() {
    this.el.pause.classList.remove('hidden');
    this.el.options.classList.add('hidden');
    this.el.keybinds.classList.add('hidden');
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
    this.el.scoreVal.textContent = Math.floor(score);

    // Population & infection counters
    if (this.game && this.game.bots) {
      this.el.npcCount.textContent = this.game.bots.aliveCount();
      this.updateInfection(this.game.bots.infectedCount());
    }

    // Highlight active weapon slot (cached elements — no per-frame query)
    const activeKey = weapon.weaponKeys[weapon.currentIndex];
    for (let i = 0; i < this.weaponSlots.length; i++) {
      const s = this.weaponSlots[i];
      s.classList.toggle('active', s.dataset.w === activeKey);
      // Hide weapon slots until owned
      s.classList.toggle('hidden', !weapon.owned[s.dataset.w]);
    }

    // Toggle scope overlay when zoomed with sniper
    const isZoomed = weapon.zoomed && weapon.zoomAmount > 0.5;
    this.el.scope.classList.toggle('hidden', !isZoomed);
    this.el.crosshair.classList.toggle('hidden', isZoomed);
  }

  updateInfection(count) {
    this.el.infectionCount.textContent = count;
    this.el.infectionCounter.classList.toggle('hidden', count <= 0);
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

  // Social stealth radar: hides unrevealed civilians, reveals gunshots and tagged targets
  drawMinimap(player, bots, world) {
    const ctx = this.minimapCtx;
    const size = this.el.minimap.width;
    ctx.clearRect(0, 0, size, size);
    const scale = size / (CONFIG.worldSize * 2);

    // Buildings / Obstacles
    ctx.fillStyle = 'rgba(90, 110, 130, 0.45)';
    for (const o of world.obstacles) {
      if (o.crate) continue;
      const x = (o.minX + CONFIG.worldSize) * scale;
      const y = (o.minZ + CONFIG.worldSize) * scale;
      const w = (o.maxX - o.minX) * scale;
      const h = (o.maxZ - o.minZ) * scale;
      ctx.fillRect(x, y, w, h);
    }

    // Bots (Only visible if tagged or actively revealed by noise)
    for (const bot of bots) {
      if (!bot.alive) continue;

      const isRevealed = bot.revealed > 0;
      const isTagged = bot.tagged;

      // Unrevealed and untagged NPCs stay off the radar to maintain identity mystery
      if (!isRevealed && !isTagged) continue;

      const bx = (bot.pos.x + CONFIG.worldSize) * scale;
      const by = (bot.pos.z + CONFIG.worldSize) * scale;
      const heightDelta = bot.pos.y - player.pos.y;

      if (isRevealed) {
        // Spotlight / Gunfire lock: flashing red beacon
        ctx.fillStyle = '#ff2d78';
        ctx.beginPath();
        ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isTagged) {
        // Player tagged suspect: steady cyan blip
        ctx.fillStyle = '#00e5ff';
        ctx.beginPath();
        ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Vertical elevation indicator (multi-story buildings)
      if (Math.abs(heightDelta) > 1.8) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px sans-serif';
        ctx.fillText(heightDelta > 0 ? '▲' : '▼', bx - 3, by - 5);
      }
    }

    // Player position
    ctx.fillStyle = '#00e5ff';
    const px = (player.pos.x + CONFIG.worldSize) * scale;
    const py = (player.pos.z + CONFIG.worldSize) * scale;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();

    // Player forward line
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - Math.sin(player.yaw) * 10, py - Math.cos(player.yaw) * 10);
    ctx.stroke();
  }
}
