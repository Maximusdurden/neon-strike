// Main game class: renderer, loop, state management, wiring.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Weapon } from './weapons.js';
import { Bots } from './bots.js';
import { Pickups } from './pickups.js';
import { Effects } from './effects.js';
import { AudioManager } from './audio.js';
import { UI } from './ui.js';
import { Story } from './story.js';

export class Game {
  constructor() {
    this.state = 'menu'; // menu | playing | paused | gameover
    this.score = 0;
    this.kills = 0;

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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.getElementById('app').appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initSystems() {
    this.audio = new AudioManager();
    this.world = new World(this.scene);
    this.effects = new Effects(this.scene);
    this.player = new Player(this.camera, this.world);
    this.bots = new Bots(this.scene, this.world, this.effects, this.audio, (source) => {
      if (source === this.player) this.onBotKilled();
    }, (pos, type) => {
      this.pickups.dropAt(pos, type);
    }, () => {
      this.onPlayerDamaged();
    }, () => {
      this.onCivilianKilled();
    });
    this.bots.playerRef = this.player;
    this.weapon = new Weapon(this.scene, this.player, this.world, this.effects, this.audio, this.bots);
    this.pickups = new Pickups(this.scene, this.world, this.audio, (label) => {
      this.ui.showPickupBadge(label);
    });
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
      joyX: 0,
      joyY: 0,
    };

    document.addEventListener('keydown', (e) => { this.input.keys[e.code] = true; });
    document.addEventListener('keyup', (e) => { this.input.keys[e.code] = false; });

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

  start() {
    this.audio.init();
    this.audio.resume();
    this.audio.startMusic();

    this.score = 0;
    this.kills = 0;
    this.player.reset();
    this.weapon.reset();
    this.bots.clearAll();
    this.pickups.spawnAll();
    this.world.setRaining(Math.random() < 0.4);
    this.story.start();

    // Hide countdown phase (initial intermission before wave 1)
    this.hideTimer = CONFIG.hidePhase.duration;
    this.state = 'hiding';
    this.ui.showHUD();
    this.ui.showHideCountdown(this.hideTimer);
    this.renderer.domElement.requestPointerLock();
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

  onBotKilled() {
    this.kills++;
    this.score += 100;
    this.ui.addKillFeed('BOT ELIMINATED +100');
    this.ui.showHitmarker();
    this.story.onKill();
  }

  onPlayerDamaged() {
    this.ui.showDamage();
  }

  onCivilianKilled() {
    // You shot an innocent civilian — game over.
    this.state = 'gameover';
    this.audio.explosion();
    this.ui.showGameOver(this.score, this.kills, 'YOU SHOT A CIVILIAN');
    document.exitPointerLock();
  }

  _update(dt) {
    if (this.state !== 'playing' && this.state !== 'hiding') return;

    // Reset per-frame input deltas
    const mouseDX = this.input.mouseDX;
    const mouseDY = this.input.mouseDY;
    this.input.mouseDX = 0;
    this.input.mouseDY = 0;

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
    if (step === 'step') this.audio.footstep();

    // Hide countdown phase
    if (this.state === 'hiding') {
      this.hideTimer -= dt;
      this.ui.showHideCountdown(this.hideTimer);
      if (this.hideTimer <= 0) {
        this.state = 'playing';
        this.ui.hideHideCountdown();
        this.ui.addKillFeed('WAVE 1 INCOMING!');
        this.audio.kill();
        // Start wave 1 immediately
        this.story._startWave();
      }
    }

    // Firing (disabled during hide phase)
    if (this.input.firing && this.state === 'playing') {
      const result = this.weapon.tryFire();
      if (result && result.type === 'bot' && result.killed) {
        // handled in onBotKilled via bots.kill
      }
      // Gunshots alert nearby bots (but not melee attacks)
      if (result && !this.weapon.current.melee) {
        this.bots.alert(this.player.pos);
      }
    }

    // Zoom (sniper scope) — right mouse button
    this.weapon.setZoom(this.input.zooming);

    this.weapon.update(dt);
    this.bots.update(dt, this.player, this.state === 'hiding');
    this.bots.updateInfection(dt);
    this.pickups.update(dt, this.player, this.weapon);
    this.world.update(dt);
    this.effects.update(dt);
    this.story.update(dt);

    // Player death
    if (!this.player.alive) {
      this.state = 'gameover';
      this.audio.explosion();
      this.effects.explosion(this.player.pos.clone(), 'blood', 40, 10);
      this.ui.showGameOver(this.score, this.kills);
      document.exitPointerLock();
    }

    // HUD
    this.ui.updateHUD(this.player, this.weapon, this.score);
    this.ui.updateStamina(this.player.stamina);
    this.ui.updateObjective(this.story.getObjectiveText());
    this.ui.updateBanner(this.story.getBanner());
    this.ui.drawMinimap(this.player, this.bots.bots, this.world);
    // Low-health red tint + slow-down
    this.ui.updateLowHealth(this.player.health, this.player.maxHealth);
    this.player.setSlowFactor(this.player.health / this.player.maxHealth);
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
});
