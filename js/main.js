// Main game class: renderer, loop, state management, wiring.

import * as THREE from 'three';
import { ASSET_VERSION } from './version.js';
import { CONFIG } from './config.js?v=20261002c';
import { World } from './world.js?v=20261002c';
import { Player } from './player.js?v=20261002c';
import { Weapon } from './weapons.js?v=20261002c';
import { Bots } from './bots.js?v=20261002c';
import { Pickups } from './pickups.js?v=20261002c';
import { Effects } from './effects.js?v=20261002c';
import { AudioManager } from './audio.js?v=20261002c';
import { UI } from './ui.js?v=20261002c';
import { Story } from './story.js?v=20261002c';
import { Keybinds } from './keybinds.js?v=20261002c';
import { NetworkManager } from './network.js?v=20261002c';

export class Game {
  constructor() {
    this.state = 'menu'; // menu | hiding | playing | paused | gameover
    this.score = 0;
    this.kills = 0;

    // Match mode: 'solo' | 'ai_duel' | 'pvp_duel' | 'coop'
    this.gameMode = 'solo';
    this.networkRole = null; // 'host' | 'client' | null
    this.network = new NetworkManager();

    // Keybind manager (loads persisted bindings from localStorage).
    this.keybinds = new Keybinds();

    // Time tracking for the game-over screen.
    // gameTimeSurvived = in-game days survived (sun rotations).
    // playerTime = real seconds physically playing this match (paused excluded).
    this.gameTimeSurvived = 0;   // seconds of in-game time survived
    this.playerTime = 0;         // seconds of real time in the match
    this._lastDayCount = 0;      // for detecting sun rotations
    this._lastPlayerTime = 0;    // for accumulating player time

    // Tagging economy: cooldown prevents spamming every civilian.
    this.lastTagTime = -999;
    this.tagCooldown = 2.5; // seconds between suspect verifications

    // Pressure scoring & Black-Box Uplink multiplier beacons.
    this.scoreMultiplier = 1;
    this._scoreAccum = 0;          // fractional carry for whole-point scoring
    this.multiplierTimer = 0;      // seconds remaining of the active multiplier
    this.highestTierUnlocked = 1;  // 1 = no multiplier yet; unlocks 2x, 3x, 4x, 5x
    this.uplinkActive = false;     // a beacon is currently spawned
    this.uplinkTimer = 0;          // seconds until the beacon despawns
    this.uplinkCooldown = 0;       // seconds until the next beacon can spawn
    this.uplinkPos = null;         // THREE.Vector3 of the live beacon
    this.uplinkTier = 0;           // multiplier value of the live beacon
    this.uplinkMesh = null;        // THREE.Mesh of the beacon pillar

    // Stadium floodlights + circuit breaker hold charge.
    this.stadiumLightsActive = false;
    this._breakerHold = 0;

    // Starting NPC population (adjustable via the options slider).
    this.startingNPCs = CONFIG.startingNPCs;

    // Cached vectors for raycasts to eliminate heap allocation stutter.
    this._tagOrigin = new THREE.Vector3();
    this._tagDir = new THREE.Vector3();
    this._botCenter = new THREE.Vector3();
    this._toCenter = new THREE.Vector3();

    this._initRenderer();
    this._initSystems();
    this._initInput();

    this.ui = new UI(this);
    this.ui.showMenu();

    this.clock = new THREE.Clock();
    this._bindPointerLock();
    this._animate();
  }

  _initRenderer() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Film-grade color science: ACES film curve, balanced exposure, sRGB gamma.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initSystems() {
    this.audio = new AudioManager();
    // World is built lazily in start() so multiplayer can seed it first.
    this.world = new World(this.scene);
    this.effects = new Effects(this.scene);
    this.player = new Player(this.camera, this.world, this.keybinds);
    this.bots = new Bots(this.scene, this.world, this.effects, this.audio, (source, wasInfected) => {
      if (source === this.player) this.onBotKilled(wasInfected);
    }, (pos, type) => {
      this.pickups.dropAt(pos, type);
    }, () => {
      this.onPlayerDamaged();
    }, () => {
      this.onCivilianKilled();
    });
    // PVP: the rival (client player) was killed by infected — notify the client.
    this.bots.onRivalKilled = () => {
      if (this.networkRole === 'host' && this.rival) {
        this.rival.alive = false;
        if (this.rival.group.parent) this.scene.remove(this.rival.group);
        this.network.send('gameover', { reason: 'THE INFECTED GOT YOU' });
      }
    };
    this.bots.playerRef = this.player;
    this.weapon = new Weapon(this.scene, this.player, this.world, this.effects, this.audio, this.bots);
    this.pickups = new Pickups(this.scene, this.world, this.audio, (label) => {
      this.ui.showPickupBadge(label);
    });
    // Render-only clients request pickups from the host instead of collecting locally.
    this.pickups.onCollect = (p) => {
      if (this.networkRole === 'client') {
        this.network.send('collect', { id: this.pickups.pickups.indexOf(p) });
      }
    };
    this.story = new Story(this);
  }

  _initInput() {
    this.input = {
      keys: {},
      mouseDX: 0,
      mouseDY: 0,
      firing: false,
      zooming: false,
      jumpPressed: false,
      shovePressed: false,
      joyX: 0,
      joyY: 0,
    };

    document.addEventListener('keydown', (e) => { this.input.keys[e.code] = true; });
    document.addEventListener('keyup', (e) => { this.input.keys[e.code] = false; });

    // Shove: bound key (default V), or right-click while unarmed/knife
    document.addEventListener('keydown', (e) => {
      if (e.code === this.keybinds.get('shove') && this.state === 'playing') this.input.shovePressed = true;
    });

    // Tag (E) and Interact (F) — wired to their bound keys.
    document.addEventListener('keydown', (e) => {
      if (this.state !== 'playing') return;
      if (e.code === this.keybinds.get('tag')) {
        this.tagCurrentTarget();
      } else if (e.code === this.keybinds.get('interact')) {
        this.interact();
      }
    });

    // Flashlight toggle (KeyF) — works during play and hide phases.
    // Shares the interact key: a tap toggles the beam, while holding it at the
    // stadium breaker charges the grid (handled in _update). Suppressed at the
    // breaker so charging the grid doesn't also switch the beam on.
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code !== this.keybinds.get('interact')) return;
      if (this.state !== 'playing' && this.state !== 'hiding') return;
      if (this.world.isAtBreaker(this.player.pos)) return;
      this.player.toggleFlashlight();
      this.audio.pickup();
    });

    document.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' && this.state !== 'hiding') return;
      this.input.mouseDX += e.movementX;
      this.input.mouseDY += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (e.button === 0) this.input.firing = true;
      if (e.button === 2) this.input.zooming = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.firing = false;
      if (e.button === 2) this.input.zooming = false;
    });
    // Prevent context menu on right-click
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindPointerLock() {
    document.addEventListener('click', () => {
      if ((this.state === 'playing' || this.state === 'hiding') && document.pointerLockElement !== this.renderer.domElement) {
        this.renderer.domElement.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.renderer.domElement && this.state === 'playing') {
        // Lost lock -> pause
        this.togglePause();
      }
    });
  }

  start(mode = 'solo', networkRole = null, seed = null, raining = null) {
    this.audio.init();
    this.audio.resume();
    this.audio.startMusic();

    this.gameMode = mode;
    this.networkRole = networkRole;
    this.score = 0;
    this.kills = 0;
    this.gameTimeSurvived = 0;
    this.playerTime = 0;
    this._lastDayCount = 0;
    this._lastPlayerTime = performance.now() / 1000;
    this._downed = false;
    this._reviveTimer = 0;
    this._reviveProgress = 0;
    this._huntStarted = false;
    this._hadInfection = false;
    // Reset pressure scoring & uplink state.
    this.scoreMultiplier = 1;
    this._scoreAccum = 0;
    this.multiplierTimer = 0;
    this.highestTierUnlocked = 1;
    this.uplinkActive = false;
    this.uplinkTimer = 0;
    this.uplinkCooldown = CONFIG.uplink.cooldown;
    this.uplinkPos = null;
    this.uplinkTier = 0;
    this._clearUplinkMesh();
    // Reset stadium floodlights and the breaker hold charge.
    this.stadiumLightsActive = false;
    this._breakerHold = 0;
    if (this.world.setStadiumLights) this.world.setStadiumLights(false);
    this.player.reset();
    this.weapon.reset();
    this.bots.clearAll();
    this._clearRival();
    // Build the city once (solo: unseeded; multiplayer: host's seed).
    if (!this.world.built) this.world.build(seed);
    // Client is render-only: the host runs the simulation and broadcasts state.
    this.bots.renderOnly = networkRole === 'client';
    this.weapon.authoritative = networkRole !== 'client';
    this.pickups.renderOnly = networkRole === 'client';
    // Spawn the starting population so the infected isn't easy to find.
    this.bots.spawnInitial(this.startingNPCs);
    this.pickups.spawnAll();
    if (raining === null) this.world.setRaining(Math.random() < 0.4);
    else this.world.setRaining(raining);
    this.story.start();

    // PVP duel: spawn the rival player using the civilian mesh rig.
    // AI duel: spawn an AI hunter rival that hunts the player.
    if (mode === 'pvp_duel' || mode === 'ai_duel') {
      this._spawnRival();
      if (mode === 'ai_duel') {
        this.rival.name = 'HUNTER';
        this.rival.isAI = true;
        // The AI hunter is hostile — it hunts the player like an infected.
        this.rival.state = 'hunt';
        this.rival.speed = CONFIG.bot.speed * 1.1;
        this.rival.attackRange = 2.0;
        this.rival.attackCooldown = 0;
        this.rival.attackInterval = 0.8;
        this.rival.damageAmount = 15;
        this.rival.lastKnownPlayerPos = null;
        this.rival.repathTimer = 0;
      }
    }

    // Hide countdown phase (initial intermission before the hunt begins)
    this.hideTimer = CONFIG.hidePhase.duration;
    this.state = 'hiding';
    this.ui.showHUD();
    this.ui.showHideCountdown(this.hideTimer);
    this.renderer.domElement.requestPointerLock();
  }

  // Spawn the rival player (PVP) as a civilian-looking humanoid.
  _spawnRival() {
    const { group, parts } = this.bots._buildHumanoid();
    this.rival = {
      group,
      parts,
      pos: new THREE.Vector3(8, 0, 8),
      yaw: 0,
      alive: true,
      health: 100,
      maxHealth: 100,
      name: 'RIVAL',
      // Damage method so bots can target the rival like the host player.
      damage(amount) {
        if (!this.alive) return;
        this.health -= amount;
        if (this.health <= 0) {
          this.health = 0;
          this.alive = false;
        }
      },
    };
    group.position.copy(this.rival.pos);
    this.scene.add(group);
  }

  _clearRival() {
    if (this.rival) {
      if (this.rival.group.parent) this.scene.remove(this.rival.group);
      this.rival = null;
    }
  }

  // AI duel: the AI hunter hunts the player. It paths toward the player,
  // attacks on contact, and reacts to gunfire (homes to the last shot).
  _updateAIHunter(dt) {
    const h = this.rival;
    const toPlayer = this.player.pos.clone().sub(h.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    // Repath periodically (cheap pathfinding via doors when blocked).
    h.repathTimer -= dt;
    if (h.repathTimer <= 0) {
      h.repathTimer = 0.5;
      if (!this.world.hasLineOfSight(h.pos, this.player.pos)) {
        const waypoint = this.world.findPathTo(h.pos, this.player.pos);
        h.moveTarget = waypoint || this.player.pos.clone();
      } else {
        h.moveTarget = this.player.pos.clone();
      }
    }

    // Move toward the player (or last known position if recently fired).
    const target = h.lastKnownPlayerPos && dist > 20 ? h.lastKnownPlayerPos : h.moveTarget || this.player.pos;
    const toTarget = target.clone().sub(h.pos);
    toTarget.y = 0;
    if (toTarget.length() > 0.5) {
      toTarget.normalize();
      h.pos.addScaledVector(toTarget, h.speed * dt);
      h.group.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    }
    this.world.resolveCollision(h.pos, 0.5);
    h.group.position.copy(h.pos);

    // Animate limbs (walk cycle).
    h.walkPhase = (h.walkPhase || 0) + dt * 9;
    const swing = Math.sin(h.walkPhase) * 0.6;
    const swing2 = Math.sin(h.walkPhase + Math.PI) * 0.6;
    h.parts.legL.rotation.x = swing;
    h.parts.legR.rotation.x = swing2;
    h.parts.armL.rotation.x = -swing2 * 0.7;
    h.parts.armR.rotation.x = -swing * 0.7;
    h.group.position.y = Math.abs(Math.sin(performance.now() / 300)) * 0.05;
    if (h.parts.shadow) h.parts.shadow.position.y = -h.group.position.y + 0.01;

    // Attack on contact.
    h.attackCooldown -= dt;
    if (dist < h.attackRange && this.player.alive && h.attackCooldown <= 0) {
      h.attackCooldown = h.attackInterval;
      this.player.damage(h.damageAmount);
      this.ui.showDamage();
      this.audio.hurt();
      this.effects.impact(this.player.pos.clone(), new THREE.Vector3(0, 1, 0));
    }

    // If the player fired recently, home toward the last known shot location.
    if (this.player.lastShotTime && performance.now() / 1000 - this.player.lastShotTime < 3) {
      h.lastKnownPlayerPos = this.player.pos.clone();
    }
  }

  // --- Multiplayer networking ---

  // Host a PVP or Co-op room. Returns a promise resolving with the room code.
  hostRoom(mode) {
    // Pick the world seed BEFORE building so the client can rebuild the same city.
    this._worldSeed = Math.floor(Math.random() * 1e9);
    return this.network.createRoom(
      (code) => {
        // Client connected — start the match.
        this.ui.setLobbyStatus('Player joined! Starting...');
        setTimeout(() => {
          this.start(mode, 'host', this._worldSeed);
          this._sendHostInit();
        }, 800);
      },
      (data) => this._onNetworkMessage(data),
      () => {
        this.ui.setLobbyStatus('Player disconnected.');
      }
    ).then((code) => {
      this.ui.showLobbyHost(code);
      return code;
    });
  }

  // Join a PVP or Co-op room by code.
  joinRoom(mode, code) {
    return this.network.joinRoom(
      code,
      () => {
        // Connected to host — wait for the match to start.
        this.ui.setLobbyStatus('Connected! Waiting for host...');
      },
      (data) => this._onNetworkMessage(data),
      () => {
        this.ui.setLobbyStatus('Disconnected from host.');
      }
    ).then(() => {
      this.ui.showLobbyJoin();
      return code;
    });
  }

  // Host sends the initial world seed + mode to the client.
  _sendHostInit() {
    this.network.send('init', {
      mode: this.gameMode,
      seed: this._worldSeed,
      startingNPCs: this.startingNPCs,
      raining: this.world.isRaining,
    });
  }

  // Handle an incoming network message.
  _onNetworkMessage(data) {
    if (!data || !data.type) return;
    switch (data.type) {
      case 'init':
        // Client received the host's match config — rebuild the world with the
        // host's seed so both sides share the SAME city, then start the match.
        if (this.networkRole === 'client' && data.seed !== undefined) {
          this.world.build(data.seed);
        }
        this.start(data.mode || 'pvp_duel', 'client', data.seed, data.raining);
        break;
      case 'state':
        // Client applies the host's snapshot.
        if (this.networkRole === 'client') this._applyHostState(data);
        break;
      case 'action':
        // Host applies a client action (fire/tag/shove).
        if (this.networkRole === 'host') this._applyClientAction(data);
        break;
      case 'interact':
        // Host applies a client environment interaction (fuse/car/trash).
        if (this.networkRole === 'host') this._applyClientAction({ act: 'interact', p: data.p });
        break;
      case 'collect':
        // Client wants to collect a pickup — host resolves it.
        if (this.networkRole === 'host') this._applyClientCollect(data.id);
        break;
      case 'weapon':
        // Host granted the client a weapon pickup.
        if (this.networkRole === 'client' && data.key) {
          const picked = this.weapon.pickupWeapon(data.key);
          if (picked) {
            this.ui.showPickupBadge(CONFIG.weapons[data.key].name + ' ACQUIRED');
            this.audio.pickup();
          }
        }
        break;
      case 'player':
        // Host receives the client's position (renders as the rival in PVP,
        // or tracks the partner for co-op revive).
        if (this.networkRole === 'host' && data.p) {
          if (this.rival) {
            this.rival.pos.set(data.p[0], data.p[1], data.p[2]);
            this.rival.yaw = data.yaw || 0;
            this.rival.group.position.copy(this.rival.pos);
            this.rival.group.rotation.y = this.rival.yaw;
          } else {
            // Co-op: track the partner's position for revive range checks.
            if (!this._partnerPos) this._partnerPos = new THREE.Vector3();
            this._partnerPos.set(data.p[0], data.p[1], data.p[2]);
          }
        }
        break;
      case 'gameover':
        // Either side can trigger a shared game-over (co-op).
        this._remoteGameOver(data.reason);
        break;
      case 'downed':
        // Co-op: the partner is downed — show a revive prompt.
        if (this.networkRole === 'host') {
          if (this.rival) this.rival.alive = false;
          this._partnerDowned = true;
          this.ui.addKillFeed('YOUR PARTNER IS DOWN — REVIVE THEM (F)');
        }
        break;
      case 'revived':
        // Co-op: the partner was revived.
        if (this.networkRole === 'host') {
          if (this.rival) {
            this.rival.alive = true;
            this.rival.health = this.rival.maxHealth;
          }
          this._partnerDowned = false;
          this.ui.addKillFeed('PARTNER REVIVED');
        }
        // Client side: I was revived by the host.
        if (this.networkRole === 'client' && this._downed) {
          this._downed = false;
          this._reviveTimer = 0;
          this.player.alive = true;
          this.player.health = this.player.maxHealth;
          this.ui.addKillFeed('REVIVED BY YOUR PARTNER');
          this.audio.pickup();
        }
        break;
      case 'botkilled':
        // Host killed a bot (client fired) — reflect it locally + credit the client.
        if (this.networkRole === 'client' && this.bots.bots[data.id]) {
          const bot = this.bots.bots[data.id];
          if (bot.alive) {
            bot.alive = false;
            bot.respawnTimer = CONFIG.bot.respawnTime;
            if (bot.group.parent) this.scene.remove(bot.group);
            this.effects.explosion(bot.pos.clone().add(new THREE.Vector3(0, 1, 0)), 'blood', 24, 6);
            this.audio.kill();
            // Credit the client's kill (infected = neutralized, innocent = down).
            this.kills++;
            this.score += 100;
            this.ui.addKillFeed(data.infected ? 'INFECTED NEUTRALIZED +100' : 'CIVILIAN DOWN +100');
            this.ui.showHitmarker();
            this.story.onKill();
          }
        }
        break;
      case 'tagged':
        // Host tagged a bot (client tagged) — reflect it locally.
        if (this.networkRole === 'client' && this.bots.bots[data.id]) {
          const bot = this.bots.bots[data.id];
          bot.tagged = true;
          if (this.effects.tagBeacon) this.effects.tagBeacon(bot.pos);
          this.audio.tagPing(bot.infected);
        }
        break;
      case 'damaged':
        // Host says the client's player took damage (bots or PVP fire).
        if (this.networkRole === 'client') {
          this.player.damage(data.amount || 15);
          this.ui.showDamage();
          this.audio.hurt();
        }
        break;
      case 'hit':
        // Host confirms the client's shot hit the host player (PVP).
        if (this.networkRole === 'client') {
          this.ui.showHitmarker();
          this.audio.hit();
        }
        break;
    }
  }

  // Client: apply a host state snapshot (bots + rival positions).
  _applyHostState(data) {
    // Update rival (the host player) position.
    if (this.rival && data.p) {
      this.rival.pos.set(data.p[0], data.p[1], data.p[2]);
      this.rival.yaw = data.p[3];
      this.rival.group.position.copy(this.rival.pos);
      this.rival.group.rotation.y = data.p[3];
    }
    // Update bot transforms from the snapshot.
    if (data.bots && this.bots.bots) {
      for (const delta of data.bots) {
        const bot = this.bots.bots[delta[0]];
        if (!bot) continue;
        bot.pos.set(delta[1], delta[2], delta[3]);
        bot.group.position.copy(bot.pos);
        bot.group.rotation.y = delta[4];
        const flags = delta[5];
        bot.infected = (flags & 1) === 1;
        bot.tagged = (flags & 2) === 2;
        bot.revealed = (flags & 4) === 4 ? bot.revealed || 1 : 0;
        const wasAlive = bot.alive;
        bot.alive = (flags & 8) !== 8;
        // Show/hide the mesh when the host kills or revives a bot.
        if (wasAlive && !bot.alive) {
          if (bot.group.parent) this.scene.remove(bot.group);
        } else if (!wasAlive && bot.alive) {
          if (!bot.group.parent) this.scene.add(bot.group);
        }
      }
    }
    if (typeof data.infCount === 'number') {
      this._remoteInfectedCount = data.infCount;
    }
    // Apply pickup states from the host (show/hide meshes).
    if (data.pickups && this.pickups.pickups) {
      for (const [idx, active] of data.pickups) {
        const p = this.pickups.pickups[idx];
        if (!p) continue;
        const wasActive = p.active;
        p.active = active === 1;
        if (wasActive && !p.active) {
          p.mesh.visible = false;
          if (p.beam) p.beam.visible = false;
        } else if (!wasActive && p.active) {
          p.mesh.visible = true;
          if (p.beam) p.beam.visible = true;
        }
      }
    }
  }

  // Host: apply a client action (fire/tag/shove/interact). The host is
  // authoritative — it resolves hits against its own simulation and broadcasts.
  _applyClientAction(data) {
    // Interact messages carry only a position (no origin/dir).
    if (data.act === 'interact') {
      const p = new THREE.Vector3(data.p[0], data.p[1], data.p[2]);
      // Co-op: the client pressed F near the downed HOST — revive the host.
      if (this.gameMode === 'coop' && this._downed && this.player.pos.distanceTo(p) < CONFIG.coop.reviveRange) {
        this._downed = false;
        this._reviveTimer = 0;
        this.player.alive = true;
        this.player.health = this.player.maxHealth;
        this.ui.addKillFeed('REVIVED BY YOUR PARTNER');
        this.audio.pickup();
        this.network.send('revived', {});
        return;
      }
      if (this.world.interactFuseBox(p)) {
        this.audio.alarm();
        this.ui.addKillFeed('POWER CUT — LIGHTS OUT');
        return;
      }
      if (this.world.triggerCarAlarm(p)) {
        this.audio.alarm();
        this.ui.addKillFeed('CAR ALARM!');
        this.bots.alert(p.clone());
        this.bots.alertNoise(p, CONFIG.env.alarmRadius);
        return;
      }
      if (this.world.triggerTrashCan(p)) {
        this.audio.alarm();
        this.ui.addKillFeed('TRASH CAN KICKED!');
        this.bots.alertNoise(p, CONFIG.env.alarmRadius);
        return;
      }
      return;
    }

    const origin = new THREE.Vector3(data.origin[0], data.origin[1], data.origin[2]);
    const dir = new THREE.Vector3(data.dir[0], data.dir[1], data.dir[2]);

    if (data.act === 'fire') {
      // 1. Check if the shot hit the host player (PVP).
      if (this.rival) {
        const toHost = this.player.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
        const dist = toHost.length();
        if (dist < 60) {
          const t = toHost.normalize().dot(dir);
          if (t > 0.9) {
            // Hit! The host player takes damage.
            this.player.damage(30);
            this.ui.showDamage();
            this.network.send('hit', {});
          }
        }
      }
      // 2. Check if the shot hit a bot (shared simulation).
      const bodyCenter = new THREE.Vector3(0, 1.5, 0);
      const bodyRadius = 0.7;
      let best = null;
      let bestDist = 60;
      for (const bot of this.bots.bots) {
        if (!bot.alive) continue;
        const center = bot.pos.clone().add(bodyCenter);
        const toCenter = center.clone().sub(origin);
        const dist = toCenter.length();
        if (dist > bestDist) continue;
        const t = toCenter.clone().normalize().dot(dir);
        if (t > 0) {
          const closest = origin.clone().addScaledVector(dir, dist * t);
          if (closest.distanceTo(center) < bodyRadius) {
            best = bot;
            bestDist = dist * t;
          }
        }
      }
      if (best) {
        // Attribute the kill to the CLIENT, not the host — so an innocent
        // civilian shot by the client disqualifies the client, not the host.
        const wasAlive = best.alive;
        const wasInfected = best.infected;
        this.bots.suppressCivilianKill = true;
        this.bots.suppressKillCredit = true; // don't credit the host's score
        this.bots.damage(best, 34, this.player);
        this.bots.suppressKillCredit = false;
        this.bots.suppressCivilianKill = false;
        this.effects.impact(best.pos.clone().add(new THREE.Vector3(0, 1, 0)), dir);
        this.audio.hit();
        // Broadcast the kill so the client sees the bot die.
        this.network.send('botkilled', { id: this.bots.bots.indexOf(best), infected: wasInfected });
        // If the client killed an innocent civilian:
        // - Co-op: BOTH players lose (shared loss).
        // - PVP: only the client is disqualified.
        if (wasAlive && !best.alive && !wasInfected) {
          this.network.send('gameover', { reason: 'YOU SHOT AN INNOCENT CIVILIAN' });
          if (this.gameMode === 'coop') {
            this._remoteGameOver('YOUR PARTNER SHOT AN INNOCENT CIVILIAN');
          }
        }
      }
    }

    if (data.act === 'shove') {
      // Client shoved — resolve against host bots.
      const range = CONFIG.player.shove.range;
      const coneDot = CONFIG.player.shove.coneDot;
      let best = null;
      let bestDist = range;
      for (const bot of this.bots.bots) {
        if (!bot.alive) continue;
        const center = bot.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
        const toBot = center.clone().sub(origin);
        const dist = toBot.length();
        if (dist > bestDist) continue;
        const t = toBot.clone().normalize().dot(dir);
        if (t > coneDot) {
          const closest = origin.clone().addScaledVector(dir, dist * t);
          if (closest.distanceTo(center) < 1.0) {
            best = bot;
            bestDist = dist;
          }
        }
      }
      if (best) {
        const push = dir.clone().multiplyScalar(CONFIG.player.shove.pushForce);
        best.pos.add(push);
        this.world.resolveCollision(best.pos, 0.5);
        best.group.position.copy(best.pos);
        if (best.infected) {
          best.state = 'chase';
          best.lastDamageTime = performance.now() / 1000;
        } else {
          best.state = 'patrol';
          best.coverPoint = null;
        }
      }
    }

    if (data.act === 'tag') {
      // Client tagged — resolve against host bots.
      const range = 12;
      let best = null;
      let bestDist = range;
      for (const bot of this.bots.bots) {
        if (!bot.alive) continue;
        const center = bot.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
        const toCenter = center.clone().sub(origin);
        const dist = toCenter.length();
        if (dist > bestDist) continue;
        const t = toCenter.clone().normalize().dot(dir);
        if (t > 0.94) {
          best = bot;
          bestDist = dist;
        }
      }
      if (best) {
        best.tagged = true;
        this.network.send('tagged', { id: this.bots.bots.indexOf(best) });
      }
    }
  }

  // Host: resolve a client's pickup collection request.
  _applyClientCollect(id) {
    const p = this.pickups.pickups[id];
    if (!p || !p.active) return;
    // The client is within range (host trusts the client's position roughly).
    p.active = false;
    p.mesh.visible = false;
    if (p.beam) p.beam.visible = false;
    p.respawnTimer = p.isDrop ? 9999 : CONFIG.pickup.respawnTime;
    // Weapon pickups: tell the client which weapon it acquired.
    if (p.type === 'weapon') {
      this.network.send('weapon', { key: p.weaponKey });
    }
    // The client applies the state via the next snapshot.
  }

  // Client: send an action to the host.
  sendAction(act, origin, dir, weapon) {
    if (this.networkRole !== 'client') return;
    this.network.send('action', {
      act,
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
      weapon: weapon || 'knife',
    });
  }

  // Client: send local player position to the host (for rival rendering).
  sendPlayerState() {
    if (this.networkRole !== 'client') return;
    this.network.send('player', {
      p: [this.player.pos.x, this.player.pos.y, this.player.pos.z],
      yaw: this.player.yaw,
    });
  }

  // Host: broadcast a state snapshot to the client (30 Hz).
  broadcastState() {
    if (this.networkRole !== 'host' || !this.network.connected) return;
    const bots = [];
    for (let i = 0; i < this.bots.bots.length; i++) {
      const b = this.bots.bots[i];
      let flags = 0;
      if (b.infected) flags |= 1;
      if (b.tagged) flags |= 2;
      if (b.revealed > 0) flags |= 4;
      if (!b.alive) flags |= 8;
      bots.push([i, b.pos.x, b.pos.y, b.pos.z, b.group.rotation.y, flags]);
    }
    // Pickup states: [index, active(1/0)] — the client shows/hides meshes.
    const pickups = [];
    for (let i = 0; i < this.pickups.pickups.length; i++) {
      const p = this.pickups.pickups[i];
      pickups.push([i, p.active ? 1 : 0]);
    }
    this.network.send('state', {
      p: [this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.yaw, 0],
      w: 1,
      infCount: this.bots.infectedCount(),
      bots,
      pickups,
    });
  }

  // Trigger a shared game-over (co-op: either player's innocent kill loses both).
  _remoteGameOver(reason) {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.audio.explosion();
    this.ui.showGameOver(this.score, this.kills, reason || 'MATCH OVER', this.gameTimeSurvived, this.playerTime);
    document.exitPointerLock();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.ui.showPause();
      document.exitPointerLock();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.hidePause();
      this.renderer.domElement.requestPointerLock();
    }
  }

  onBotKilled(wasInfected) {
    this.kills++;
      // Kill Bounty = (100 × Active Multiplier) + (Active Infected Count × 10)
      const infectedBonus = this.bots.infectedCount() * CONFIG.scoring.killPerInfected;
      const points = Math.round((CONFIG.scoring.killBase * this.scoreMultiplier) + infectedBonus);
      this.score += points;
      // Accurate kill feed: infected = neutralized, innocent = civilian down.
      this.ui.addKillFeed(wasInfected ? `HOST NEUTRALIZED +${points}` : `CIVILIAN DOWN +${points}`);
      this.ui.showHitmarker();
      this.story.onKill();
    }

  onPlayerDamaged() {
    this.ui.showDamage();
  }

  onCivilianKilled() {
    // You shot an innocent civilian — game over.
    // In co-op, both players lose. In PVP, the shooter is disqualified.
    this.state = 'gameover';
    this.audio.explosion();
    const reason = 'COVER BLOWN: CIVILIAN CASUALTY';
    this.ui.showGameOver(this.score, this.kills, reason, this.gameTimeSurvived, this.playerTime);
    document.exitPointerLock();
    // Notify the remote player (co-op shared loss only — in PVP the client
    // keeps playing and wins by default).
    if (this.network.connected && this.gameMode === 'coop') {
      this.network.send('gameover', { reason });
    }
  }

  // --- Black-Box Uplink multiplier beacons ---

  // Spawn the next eligible uplink beacon at a random open street/roof spot.
  // Tiers must be earned in sequence: 2x -> 3x -> 4x -> 5x -> Apex (random 2x-5x).
  _spawnUplink() {
    if (this.uplinkActive) return;
    // Determine the tier.
    let tier;
    if (this.highestTierUnlocked < CONFIG.uplink.tiers.length) {
      tier = CONFIG.uplink.tiers[this.highestTierUnlocked - 1];
    } else {
      // Apex tier: random 2x-5x.
      tier = CONFIG.uplink.apexTiers[Math.floor(Math.random() * CONFIG.uplink.apexTiers.length)];
    }

    // Find an open position (not colliding with obstacles).
    let x, z, attempts = 0;
    do {
      x = (Math.random() * 2 - 1) * (CONFIG.worldSize - 15);
      z = (Math.random() * 2 - 1) * (CONFIG.worldSize - 15);
      attempts++;
    } while (this.world.collides(x, z, 0.8) && attempts < 50);

    this.uplinkActive = true;
    this.uplinkTimer = CONFIG.uplink.lifetime;
    this.uplinkTier = tier;
    this.uplinkPos = new THREE.Vector3(x, 0, z);

    // Illuminated light pillar.
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 20, 10, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.uplinkMesh = new THREE.Mesh(beamGeo, beamMat);
    this.uplinkMesh.position.set(x, 10, z);
    this.scene.add(this.uplinkMesh);

    // Global broadcast: HUD banner + audio alert.
    this.ui.addKillFeed(`BLACK-BOX UPLINK DETECTED: ${tier}X`);
    this.audio.pickup();
  }

  // Remove the live uplink beacon mesh (despawn or collection).
  _clearUplinkMesh() {
    if (this.uplinkMesh) {
      if (this.uplinkMesh.parent) this.scene.remove(this.uplinkMesh);
      this.uplinkMesh = null;
    }
  }

  // Collect the live uplink beacon: activate the multiplier for its duration.
  _collectUplink() {
    if (!this.uplinkActive || !this.uplinkPos) return;
    const tier = this.uplinkTier;
    this.scoreMultiplier = tier;
    this.multiplierTimer = CONFIG.uplink.duration;
    // Advance the tier progression (2x -> 3x -> 4x -> 5x -> Apex).
    if (tier >= this.highestTierUnlocked && this.highestTierUnlocked < CONFIG.uplink.tiers.length) {
      this.highestTierUnlocked = tier + 1;
    }
    this.ui.addKillFeed(`UPLINK SECURED: ${tier}X MULTIPLIER ACTIVE!`);
    this.audio.pickup();
    this._clearUplinkMesh();
    this.uplinkActive = false;
    this.uplinkPos = null;
    this.uplinkCooldown = CONFIG.uplink.cooldown;
  }

  // Update the uplink lifecycle: spawn, despawn, cooldown, and collection.
  _updateUplink(dt) {
    // Only the host simulates beacons; clients see them via snapshots.
    if (this.networkRole === 'client') return;

    if (this.uplinkActive) {
      // Check collection: player standing on the beacon.
      if (this.uplinkPos && this.player.pos.distanceTo(this.uplinkPos) < 1.8) {
        this._collectUplink();
        return;
      }
      // Despawn timer.
      this.uplinkTimer -= dt;
      if (this.uplinkTimer <= 0) {
        this.ui.addKillFeed('UPLINK LOST — SIGNAL FADED');
        this._clearUplinkMesh();
        this.uplinkActive = false;
        this.uplinkPos = null;
        this.uplinkCooldown = CONFIG.uplink.cooldown;
      }
    } else if (this.uplinkCooldown > 0) {
      this.uplinkCooldown -= dt;
      if (this.uplinkCooldown <= 0) this._spawnUplink();
    }
  }

  // Toggle the stadium floodlight grid. When ON, the arena floods with
  // daylight illumination: stealth concealment drops to zero, bot visual
  // acquisition extends to maximum map boundaries, and every wandering
  // infected thrall is drawn toward the central generator station.
  toggleStadiumLights() {
    this.stadiumLightsActive = !this.stadiumLightsActive;
    if (this.world.setStadiumLights) {
      this.world.setStadiumLights(this.stadiumLightsActive);
    }
    this.ui.addKillFeed(this.stadiumLightsActive ? 'STADIUM GRID ONLINE — LIGHTS FLOOD THE ARENA' : 'STADIUM GRID OFFLINE');
    // When the lights come on, every infected thrall abandons its route and
    // sprints toward the central generator station.
    if (this.stadiumLightsActive && this.bots.alert) {
      const breakerPos = this.world.breaker ? this.world.breaker.pos : new THREE.Vector3(0, 0, 0);
      for (const bot of this.bots.bots) {
        if (!bot.alive || !bot.infected) continue;
        bot.lastKnownPlayerPos = breakerPos.clone();
        bot.state = 'chase';
        bot.lastDamageTime = performance.now() / 1000;
      }
    }
  }

    // Tag candidate NPC under crosshair with allocation-free geometry math.
    tagCurrentTarget() {
    const now = performance.now() / 1000;
    if (now - this.lastTagTime < this.tagCooldown) {
      const wait = Math.ceil(this.tagCooldown - (now - this.lastTagTime));
      this.ui.addKillFeed(`SCANNER RECHARGING (${wait}s)`);
      return;
    }

    this.player.camera.getWorldPosition(this._tagOrigin);
    this.player.camera.getWorldDirection(this._tagDir);

    // Render-only clients send the tag to the host to resolve.
    if (this.networkRole === 'client') {
      this.lastTagTime = now;
      this.sendAction('tag', this._tagOrigin, this._tagDir, 'tag');
      return;
    }

    let best = null;
    let bestDist = Infinity;

    for (const bot of this.bots.bots) {
      if (!bot.alive) continue;

      this._botCenter.copy(bot.pos).y += 1.5;
      this._toCenter.subVectors(this._botCenter, this._tagOrigin);
      const dist = this._toCenter.length();

      if (dist > 12) continue; // Max tag range

      const dot = this._toCenter.normalize().dot(this._tagDir);
      if (dot > 0.94) { // Narrow detection cone
        if (dist < bestDist) {
          best = bot;
          bestDist = dist;
        }
      }
    }

    if (best) {
      this.lastTagTime = now;
      best.tagged = true;
      if (this.effects.tagBeacon) this.effects.tagBeacon(best.pos);
      this.audio.tagPing(best.infected);

      if (best.infected) {
        this.ui.addKillFeed('TARGET CONFIRMED: THE WEAVE DETECTED');
      } else {
        this.ui.addKillFeed('TARGET SCAN: UNINFECTED CIVILIAN');
      }
    }
  }

  // Interact with environmental objects: fuse boxes (cut lights), car alarms,
  // trash cans (loud distractions that draw bots), and the stadium circuit
  // breaker (hold to flood the arena with light). Also revives a downed co-op
  // partner standing nearby.
  interact() {
    const p = this.player.pos;
    // Render-only clients send the interact to the host to resolve.
    if (this.networkRole === 'client') {
      // Downed players can't interact.
      if (!this.player.alive) return;
      this.network.send('interact', { p: [p.x, p.y, p.z] });
      return;
    }
    // 0. Stadium circuit breaker — hold F for 3.0s to flood the arena.
    // The hold is accumulated in _update() from the live key state, which also
    // fires the toggle; here we only report progress.
    if (this.world.isAtBreaker(p)) {
      this.ui.addKillFeed(`HOLDING BREAKER... ${Math.ceil(CONFIG.stadium.holdTime - this._breakerHold)}s`);
      return;
    }
    // 0. Co-op revive: if the partner is downed and nearby, revive them.
    if (this.gameMode === 'coop' && this._partnerDowned) {
      // PVP has a rival mesh; co-op tracks the partner's position.
      const partnerPos = this.rival ? this.rival.pos : this._partnerPos;
      if (partnerPos && this.player.pos.distanceTo(partnerPos) < CONFIG.coop.reviveRange) {
        if (this.rival) {
          this.rival.alive = true;
          this.rival.health = this.rival.maxHealth;
        }
        this._partnerDowned = false;
        this.audio.pickup();
        this.ui.addKillFeed('PARTNER REVIVED');
        this.network.send('revived', {});
        return;
      }
    }
    // 1. Fuse box — cut a building's lights for an evasion window.
    if (this.world.interactFuseBox(p)) {
      this.audio.alarm();
      this.ui.addKillFeed('POWER CUT — LIGHTS OUT');
      return;
    }
    // 2. Car alarm — loud, draws bots to the noise.
    if (this.world.triggerCarAlarm(p)) {
      this.audio.alarm();
      this.ui.addKillFeed('CAR ALARM!');
      this.bots.alert(p.clone());
      this.bots.alertNoise(p, CONFIG.env.alarmRadius);
      return;
    }
    // 3. Trash can — metallic clang, draws bots.
    if (this.world.triggerTrashCan(p)) {
      this.audio.alarm();
      this.ui.addKillFeed('TRASH CAN KICKED!');
      this.bots.alertNoise(p, CONFIG.env.alarmRadius);
      return;
    }
  }

  _update(dt) {
    if (this.state !== 'playing' && this.state !== 'hiding') return;

    // Reset per-frame input deltas
    const mouseDX = this.input.mouseDX;
    const mouseDY = this.input.mouseDY;
    this.input.mouseDX = 0;
    this.input.mouseDY = 0;

    // Stadium breaker hold: accumulate while the interact key is actually held
    // at the breaker, and decay when the player steps away or releases it.
    // The toggle fires here (not on keydown) so a continuous hold completes.
    if (this.world.isAtBreaker(this.player.pos)) {
      if (this.input.keys[this.keybinds.get('interact')]) {
        this._breakerHold = (this._breakerHold || 0) + dt;
        if (this._breakerHold >= CONFIG.stadium.holdTime) {
          this._breakerHold = 0;
          this.toggleStadiumLights();
        }
      } else {
        this._breakerHold = 0;
      }
    } else if (this._breakerHold) {
      this._breakerHold = 0;
    }

    // Mobile joystick -> keys
    if (this.input.joyX !== 0 || this.input.joyY !== 0) {
      this.input.keys['KeyW'] = this.input.joyY > 0.2;
      this.input.keys['KeyS'] = this.input.joyY < -0.2;
      this.input.keys['KeyA'] = this.input.joyX < -0.2;
      this.input.keys['KeyD'] = this.input.joyX > 0.2;
    }

    const step = this.player.update(dt, {
      keys: this.input.keys,
      mouseDX,
      mouseDY,
      jumpPressed: this.input.jumpPressed,
    });
    if (step === 'step') this.audio.footstep(this.player.sprinting);
    // Footstep noise alerts bots within the player's noise radius.
    if (this.player.noiseRadius > 0) {
      this.bots.alertNoise(this.player.pos, this.player.noiseRadius);
    }

    // Dynamic Pressure Scoring Engine:
    // Active Score Rate (pts/sec) = (5 + Active Infected Count × 2.5) × Active Multiplier
    if (this.state === 'playing') {
      // Multiplier countdown.
      if (this.multiplierTimer > 0) {
        this.multiplierTimer -= dt;
        if (this.multiplierTimer <= 0) {
          this.scoreMultiplier = 1;
          this.ui.addKillFeed('MULTIPLIER UPLINK EXPIRED');
        }
      }
      const infCount = this.bots.infectedCount();
      const densityRate = CONFIG.scoring.baseRate + (infCount * CONFIG.scoring.perInfected);
      // Accumulate fractionally, but only ever expose whole points.
      this._scoreAccum += densityRate * this.scoreMultiplier * dt;
      const whole = Math.floor(this._scoreAccum);
      if (whole > 0) {
        this.score += whole;
        this._scoreAccum -= whole;
      }
    }

    // Black-Box Uplink beacon lifecycle (spawn / despawn / collect).
    this._updateUplink(dt);

    // Sixth Sense (Neural Radar) perk: soft directional pulse + HUD radar cue
    // when an infected host enters within 14 meters.
    if (this.player.hasPerk && this.player.hasPerk('sixthSense')) {
      this._radarTimer = (this._radarTimer || 0) - dt;
      if (this._radarTimer <= 0) {
        this._radarTimer = CONFIG.perks.sixthSense.pulseInterval;
        let nearest = Infinity;
        for (const bot of this.bots.bots) {
          if (!bot.alive || !bot.infected) continue;
          const d = bot.pos.distanceTo(this.player.pos);
          if (d < nearest) nearest = d;
        }
        if (nearest < CONFIG.perks.sixthSense.range) {
          this.audio.pickup();
          this.ui.addKillFeed('NEURAL RADAR: INFECTED SIGNATURE DETECTED');
        }
      }
    }

    // Thermal Scanner perk: aiming at an NPC highlights infected micro-tells
    // (green visor hue) — the scanner reveals infected through the crosshair.
    if (this.player.hasPerk && this.player.hasPerk('thermal') && this.state === 'playing') {
      this._thermalTimer = (this._thermalTimer || 0) - dt;
      if (this._thermalTimer <= 0) {
        this._thermalTimer = 0.25; // re-check 4x/sec
        const origin = this.player.camera.getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3();
        this.player.camera.getWorldDirection(dir);
        let best = null;
        let bestDist = CONFIG.perks.thermal.range;
        for (const bot of this.bots.bots) {
          if (!bot.alive) continue;
          const center = bot.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
          const toBot = center.clone().sub(origin);
          const dist = toBot.length();
          if (dist > bestDist) continue;
          const t = toBot.clone().normalize().dot(dir);
          if (t > 0.94) {
            if (dist < bestDist) {
              best = bot;
              bestDist = dist;
            }
          }
        }
        if (best && best.infected) {
          this.ui.addKillFeed('THERMAL: INFECTED MICRO-TELL DETECTED');
        }
      }
    }

    // Creaky stairs: wooden risers creak when walked on (standing or sprinting),
    // but crouch-walking is silent. The creak also alerts nearby bots.
    if (this.player.onGround && !this.player.crouching) {
      const feetY = this.player.pos.y - this.player.standHeight;
      if (this.world.isOnCreakSurface(this.player.pos.x, this.player.pos.z, feetY)) {
        this._creakTimer = (this._creakTimer || 0) - dt;
        if (this._creakTimer <= 0) {
          this._creakTimer = CONFIG.creak.interval;
          this.audio.creak();
          this.bots.alertNoise(this.player.pos, CONFIG.creak.radius);
        }
      }
    }

    // Dynamic threat level for the horror/pursuit music engine.
    // 0 = calm stealth drone, 1 = full panic pursuit.
    let threat = 0;
    if (typeof this.bots.threatLevel === 'function') {
      threat = this.bots.threatLevel(this.player);
    } else {
      // Fallback: direct distance to nearest infected bot.
      let minDist = 999;
      for (const bot of this.bots.bots) {
        if (bot.alive && bot.infected) {
          const d = bot.pos.distanceTo(this.player.pos);
          if (d < minDist) minDist = d;
        }
      }
      threat = minDist < 16 ? 1.0 - minDist / 16 : 0;
    }
    this.audio.setThreatLevel(threat);

    // Adrenaline tunnel vision: when threat is high, expand FOV and add a
    // subtle chromatic aberration to the canvas for a panic feel.
    const adr = CONFIG.player.adrenaline;
    const targetFov = threat > adr.threatThreshold
      ? adr.baseFov + adr.fovExpansion * Math.min(1, (threat - adr.threatThreshold) / (1 - adr.threatThreshold))
      : adr.baseFov;
    this._fov = this._fov || adr.baseFov;
    this._fov += (targetFov - this._fov) * Math.min(1, 6 * dt);
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
    // Store the dynamic base FOV so the weapon zoom system respects it.
    this.camera.userData.dynamicFov = this._fov;
    // Chromatic aberration via CSS filter on the canvas (subtle, panic-only).
    const app = document.getElementById('app');
    if (app) {
      const ca = threat > adr.threatThreshold ? 0.6 : 0;
      app.style.filter = ca > 0
        ? `url(#chromatic-aberration)` : 'none';
      // Store the intensity for the SVG filter to read (set once per frame).
      if (window.__caIntensity !== ca) {
        window.__caIntensity = ca;
        const fe = document.getElementById('ca-fe');
        if (fe) fe.setAttribute('stdDeviation', String(ca * 0.8));
      }
    }

    // Hide countdown phase
    if (this.state === 'hiding') {
      this.hideTimer -= dt;
      this.ui.showHideCountdown(this.hideTimer);
      if (this.hideTimer <= 0) {
        this.state = 'playing';
        this.ui.hideHideCountdown();
        this.ui.addKillFeed('CONTAGION BREACH: PHASE 1');
        this.audio.kill();
        // Seed the infection — "the other" blends in among the NPCs.
        // Only the HOST seeds it; the client receives infected flags in snapshots.
        if (this.networkRole !== 'client') {
          this.bots.setupInfection(this.player);
          this._huntStarted = true;
          this._hadInfection = this.bots.infectedCount() > 0;
        }
      }
    }

    // Time tracking: game time = in-game clock (sun rotations), player time =
    // real seconds in the match. Both only accumulate while actively playing.
    if (this.state === 'playing' || this.state === 'hiding') {
      this.gameTimeSurvived += dt;
      const now = performance.now() / 1000;
      this.playerTime += now - this._lastPlayerTime;
      this._lastPlayerTime = now;
    } else {
      this._lastPlayerTime = performance.now() / 1000;
    }

    // Firing (disabled during hide phase)
    if (this.input.firing && this.state === 'playing') {
      const result = this.weapon.tryFire();

      if (result) {
        // Record the shot time so the AI hunter can home to it.
        this.player.lastShotTime = performance.now() / 1000;
        // Loud firearms trigger the spotlight to lock onto the player's position.
        if (!this.weapon.current.melee) {
          this.world.revealPosition(this.player.pos, 3.0); // Lock spotlight for 3s
          if (this.bots.alert) this.bots.alert(this.player.pos);
        } else {
          // Silent melee takedowns do not attract the spotlight. They emit a
          // near-silent 1.0m noise radius — no crowd stampede, no spotlight.
          if (result.type === 'bot' && result.killed && this.effects.stealthKill) {
            this.effects.stealthKill(result.pos || this.player.pos);
            this.bots.alertNoise(this.player.pos, 1.0);
          }
        }
        // In multiplayer, the CLIENT sends the shot to the host so it can
        // resolve hits on bots + the rival. The host resolves locally.
        if (this.networkRole === 'client') {
          const origin = this.player.camera.getWorldPosition(new THREE.Vector3());
          const dir = new THREE.Vector3();
          this.player.camera.getWorldDirection(dir);
          this.sendAction('fire', origin, dir, this.weapon.current.name);
        }
        // HOST: check if the shot hit the client's rival (PVP) or AI hunter (AI duel).
        if (this.networkRole === 'host' && this.rival && this.rival.alive) {
          const origin = this.player.camera.getWorldPosition(new THREE.Vector3());
          const dir = new THREE.Vector3();
          this.player.camera.getWorldDirection(dir);
          const toRival = this.rival.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(origin);
          const dist = toRival.length();
          if (dist < 60) {
            const t = toRival.normalize().dot(dir);
            if (t > 0.9) {
              // Hit! The rival takes damage.
              this.rival.health -= 30;
              this.ui.showHitmarker();
              this.audio.hit();
              if (this.rival.health <= 0) {
                this.rival.alive = false;
                if (this.rival.isAI) {
                  // AI duel: killing the hunter is a WIN.
                  this.state = 'gameover';
                  this.audio.explosion();
                  this.effects.explosion(this.rival.pos.clone(), 'blood', 40, 10);
                  this.ui.showGameOver(this.score, this.kills, 'HUNTER ELIMINATED — YOU WIN', this.gameTimeSurvived, this.playerTime);
                  document.exitPointerLock();
                } else {
                  // PVP: the client's player is eliminated.
                  this.network.send('damaged', { amount: 30 });
                  this.network.send('gameover', { reason: 'YOU WERE ELIMINATED' });
                }
              }
            }
          }
        }
      }
    }

    // Zoom (sniper scope) — right mouse button
    this.weapon.setZoom(this.input.zooming);

    // Shove / tackle (non-lethal): V key, or right-click while unarmed/knife.
    const canShove = this.weapon.current.melee || !this.weapon.current.name;
    if (this.input.shovePressed || (this.input.zooming && canShove)) {
      this.input.shovePressed = false;
      // Render-only clients send the shove to the host to resolve.
      if (this.networkRole === 'client') {
        const origin = this.player.camera.getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3();
        this.player.camera.getWorldDirection(dir);
        this.sendAction('shove', origin, dir, 'shove');
      } else {
        const shoved = this.player.shove(this.bots.bots);
        if (shoved) {
          if (shoved.infected) {
            // Infected breaks disguise: hiss, bare weapons, enter pursuit.
            this.audio.hiss();
            this.ui.addKillFeed('THE THREADED REVEALED!');
            shoved.state = 'chase';
            shoved.lastDamageTime = performance.now() / 1000;
            if (this.effects.infectionTaint) this.effects.infectionTaint(shoved.pos);
          } else {
            // Innocent civilian stumbles back and walks away angry.
            this.audio.grunt();
            this.ui.addKillFeed('CIVILIAN SHOVED');
            shoved.state = 'patrol';
            shoved.coverPoint = null;
          }
        } else {
          this.audio.swing();
        }
      }
    }

    this.weapon.update(dt);
    this.bots.update(dt, this.player, this.state === 'hiding', this.rival);
    this.bots.updateInfection(dt);
    this.pickups.update(dt, this.player, this.weapon);
    this.world.update(dt);
    this.effects.update(dt);
    this.story.update(dt);

    // AI duel: the AI hunter rival hunts the player.
    if (this.gameMode === 'ai_duel' && this.rival && this.rival.isAI && this.rival.alive) {
      this._updateAIHunter(dt);
    }

    // Infected proximity whisper: low binaural hum when near Patient Zero.
    this._whisperTimer = (this._whisperTimer || 0) - dt;
    if (this._whisperTimer <= 0) {
      this._whisperTimer = 0.8; // re-check every 0.8s
      let nearestInfected = Infinity;
      for (const bot of this.bots.bots) {
        if (!bot.alive || !bot.infected) continue;
        const d = bot.pos.distanceTo(this.player.pos);
        if (d < nearestInfected) nearestInfected = d;
      }
      if (nearestInfected < CONFIG.whisper.range) {
        const prox = 1 - nearestInfected / CONFIG.whisper.range;
        this.audio.whisper(prox);
      }
    }

    // Vertical audio cue: if the player is on an upper floor and a chasing
    // infected is on the ground floor below, play muffled rhythmic thuds.
    if (this.player.pos.y > CONFIG.player.height + 1.5) {
      this._thudTimer = (this._thudTimer || 0) - dt;
      if (this._thudTimer <= 0) {
        this._thudTimer = 1.4;
        for (const bot of this.bots.bots) {
          if (!bot.alive || !bot.infected || bot.state !== 'chase') continue;
          if (bot.pos.y < 1.0 && Math.abs(bot.pos.x - this.player.pos.x) < 12 && Math.abs(bot.pos.z - this.player.pos.z) < 12) {
            this.audio.thud();
            break;
          }
        }
      }
    }

    // Infected cold-breath particle tell: faint green vapor puffs from
    // infected heads every 8-12s — rewards patient observation.
    this._breathTimer = (this._breathTimer || 0) - dt;
    if (this._breathTimer <= 0) {
      this._breathTimer = CONFIG.breath.intervalMin + Math.random() * (CONFIG.breath.intervalMax - CONFIG.breath.intervalMin);
      for (const bot of this.bots.bots) {
        if (!bot.alive || !bot.infected) continue;
        const headPos = bot.pos.clone().add(new THREE.Vector3(0, 2.0, 0));
        for (let i = 0; i < 3; i++) {
          const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            0.4 + Math.random() * 0.3,
            (Math.random() - 0.5) * 0.3
          );
          this.effects.spawn(headPos, vel, 'infect', 1.2, 0.12, -0.1);
        }
      }
    }

    // Player death
    if (!this.player.alive) {
      // Co-op: enter a DOWNED state with a revive window instead of instant loss.
      if (this.gameMode === 'coop' && !this._downed) {
        this._downed = true;
        this._reviveTimer = CONFIG.coop.reviveWindow;
        this.ui.addKillFeed('YOU ARE DOWNED — WAIT FOR REVIVE');
        this.audio.explosion();
        this.effects.explosion(this.player.pos.clone(), 'blood', 40, 10);
        // Notify the partner so they can come revive.
        if (this.network.connected) {
          this.network.send('downed', {});
        }
      } else if (this.gameMode === 'coop' && this._downed) {
        // Count down the revive window.
        this._reviveTimer -= dt;
        if (this._reviveTimer <= 0) {
          this.state = 'gameover';
          this.ui.showGameOver(this.score, this.kills, 'NO ONE CAME TO REVIVE YOU', this.gameTimeSurvived, this.playerTime);
          document.exitPointerLock();
          if (this.network.connected) {
            this.network.send('gameover', { reason: 'YOUR PARTNER FELL' });
          }
        }
      } else {
        // Solo / PVP: instant game over.
        this.state = 'gameover';
        this.audio.explosion();
        this.effects.explosion(this.player.pos.clone(), 'blood', 40, 10);
        this.ui.showGameOver(this.score, this.kills, null, this.gameTimeSurvived, this.playerTime);
        document.exitPointerLock();
        // Notify the remote player (co-op shared loss / PVP win).
        if (this.network.connected) {
          this.network.send('gameover', { reason: this.gameMode === 'coop' ? 'YOUR PARTNER FELL' : 'YOU WIN' });
        }
      }
    }

    // WIN CONDITION: all infected eliminated (host-authoritative).
    // Only triggers after the hunt begins and at least one infected existed.
    if (this.state === 'playing' && this.networkRole !== 'client' && this._huntStarted) {
      const infCount = this.bots.infectedCount();
      if (infCount === 0 && this._hadInfection) {
        this.state = 'gameover';
        this.audio.explosion();
        this.ui.addKillFeed('ALL INFECTED ELIMINATED');
        this.ui.showGameOver(this.score, this.kills, 'ALL INFECTED ELIMINATED — YOU WIN', this.gameTimeSurvived, this.playerTime);
        document.exitPointerLock();
        // Notify the remote player (co-op shared win).
        if (this.network.connected) {
          this.network.send('gameover', { reason: 'ALL INFECTED ELIMINATED — YOU WIN' });
        }
      }
    }

    // HUD
    this.ui.updateHUD(this.player, this.weapon, this.score);
    // Render-only clients show the host's infected count, not their own (0).
    if (this.networkRole === 'client' && typeof this._remoteInfectedCount === 'number') {
      this.ui.updateInfection(this._remoteInfectedCount);
    }
    this.ui.updateStamina(this.player.stamina);
    this.ui.updateBanner(this.story.getBanner());
    this.ui.drawMinimap(this.player, this.bots.bots, this.world);
    // Low-health red tint + slow-down
    this.ui.updateLowHealth(this.player.health, this.player.maxHealth);
    this.player.setSlowFactor(this.player.health / this.player.maxHealth);

    // Network sync: host broadcasts state at ~30 Hz; client sends its position.
    this._netTimer = (this._netTimer || 0) - dt;
    if (this._netTimer <= 0) {
      this._netTimer = 1 / 30;
      if (this.networkRole === 'host') this.broadcastState();
      else if (this.networkRole === 'client') this.sendPlayerState();
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === 'playing' || this.state === 'paused' || this.state === 'hiding') {
      this._update(dt);
    }

    // Screen shake
    if (this.effects.shake > 0) {
      const s = this.effects.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.1;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.1;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
  // Expose the asset version so a stale cached module graph is easy to spot
  // in the console (compare against js/version.js).
  window.ASSET_VERSION = ASSET_VERSION;
});
