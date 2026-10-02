// First-person player controller: movement, camera, crouching, stamina, and audio radii.

import * as THREE from 'three';
import { CONFIG } from './config.js?v=20261002d';

export class Player {
  constructor(camera, world, keybinds) {
    this.camera = camera;
    this.world = world;
    this.keybinds = keybinds || null;

    // Spatial & Camera Heights
    this.standHeight = CONFIG.player.height || 1.7;
    this.crouchHeight = 0.95;
    this.currentEyeHeight = this.standHeight;

    this.pos = new THREE.Vector3(0, this.standHeight, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    // Health & Vitals
    this.health = CONFIG.player.maxHealth;
    this.maxHealth = CONFIG.player.maxHealth;
    this.alive = true;
    this.lastDamageTime = -999;
    this.slowFactor = 1;

    // Movement & Stance States
    this.onGround = true;
    this.sprinting = false;
    this.crouching = false;
    this.stepTimer = 0;
    this.noiseRadius = 0; // Read by bots to detect stealth violations

    // Stamina System
    this.stamina = CONFIG.stamina.max;
    this.maxStamina = CONFIG.stamina.max;
    this.lastSprintTime = -999;

    // Visual Bob & Recoil
    this.gunBob = 0;
    this.recoilOffset = 0;

    // Q/E peek-lean state
    this.leanTarget = 0;   // -1 (Q) .. 1 (E)
    this.leanAmount = 0;   // smoothed current lean

    // Flashlight (tactical beam) — KeyF toggle
    this.flashlightOn = false;
    this.flashlight = null; // THREE.SpotLight attached to the camera

    // Sensory perks (discovered in the environment, not baseline).
    // Each is a string id: 'sixthSense' | 'thermal' | 'softSoles' | 'adrenaline'
    this.perks = [];
    // Adrenaline syringe active timer (seconds remaining of boosted sprint).
    this.adrenalineTimer = 0;

    // Shove cooldown
    this.lastShoveTime = -999;

    // Pre-allocated vectors to prevent frame allocations
    this._moveDir = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();

    // Camera-attached tactical flashlight (THREE.SpotLight).
    // The beam is a child of the camera so it tracks the view direction.
    const fl = CONFIG.flashlight;
    this.flashlight = new THREE.SpotLight(
      fl.color,
      fl.intensity,
      fl.distance,
      fl.angle,
      0.4,
      1.2
    );
    this.flashlight.position.set(0, 0, 0);
    this.flashlight.target.position.set(0, 0, -1);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.flashlight.visible = false;
  }

  // Toggle the tactical flashlight on/off. When ON, the player becomes
  // visible from much farther inside a forward cone (stealth consequence).
  toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    if (this.flashlight) this.flashlight.visible = this.flashlightOn;
  }

  // True if the player has discovered the given sensory perk.
  hasPerk(id) {
    return this.perks.includes(id);
  }

  // Grant a discovered sensory perk. Returns true if newly acquired.
  addPerk(id) {
    if (this.hasPerk(id)) return false;
    this.perks.push(id);
    if (id === 'adrenaline') {
      // Adrenaline Syringe: instantly boost sprint for the duration.
      this.adrenalineTimer = CONFIG.perks.adrenaline.duration;
    }
    return true;
  }

  setSlowFactor(healthRatio) {
    this.slowFactor = healthRatio > 0.5 ? 1 : Math.max(0.6, 0.5 + healthRatio);
  }

  reset() {
    this.pos.set(0, this.standHeight, 0);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.lastDamageTime = -999;
    this.recoilOffset = 0;
    this.stamina = this.maxStamina;
    this.lastSprintTime = -999;
    this.crouching = false;
    this.currentEyeHeight = this.standHeight;
    this.leanTarget = 0;
    this.leanAmount = 0;
    this.lastShoveTime = -999;
    // Flashlight off on reset
    this.flashlightOn = false;
    if (this.flashlight) this.flashlight.visible = false;
    // Perks reset each match
    this.perks = [];
    this.adrenalineTimer = 0;
  }

  getMuzzleWorldPos() {
    const v = new THREE.Vector3(0, 0, -0.6);
    return this.camera.localToWorld(v);
  }

  damage(amount) {
    if (!this.alive) return;
    // I-frames: only take damage once per damageInterval so a single infected
    // touching you doesn't melt you to zero in one frame. Gives you a chance
    // to break away and find health.
    const now = performance.now() / 1000;
    if (now - this.lastDamageTime < CONFIG.player.damageInterval) return;
    this.health -= amount;
    this.lastDamageTime = now;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  heal(amount) {
    if (!this.alive) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  // Non-lethal shove: push a bot in front of the player. Returns the bot hit,
  // or null. The caller decides how to react (civilian stumbles, infected breaks disguise).
  shove(bots) {
    if (!this.alive) return null;
    const now = performance.now() / 1000;
    if (now - this.lastShoveTime < CONFIG.player.shove.cooldown) return null;
    this.lastShoveTime = now;

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const range = CONFIG.player.shove.range;
    const coneDot = CONFIG.player.shove.coneDot;

    let best = null;
    let bestDist = range;
    for (const bot of bots) {
      if (!bot.alive) continue;
      const center = bot.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
      const toBot = center.clone().sub(origin);
      const dist = toBot.length();
      if (dist > bestDist) continue;
      const t = toBot.clone().normalize().dot(dir);
      if (t > coneDot) {
        const closest = origin.clone().addScaledVector(dir, dist * t);
        if (closest.distanceTo(center) < 1.0) {
          best = { bot, dist };
          bestDist = dist;
        }
      }
    }

    if (best) {
      // Push the bot back along the shove direction.
      const push = dir.clone().multiplyScalar(CONFIG.player.shove.pushForce);
      best.bot.pos.add(push);
      this.world.resolveCollision(best.bot.pos, 0.5);
      best.bot.group.position.copy(best.bot.pos);
      return best.bot;
    }
    return null;
  }

  update(dt, input) {
    if (!this.alive) return;

    // Mouse Look
    this.yaw -= input.mouseDX * 0.0022;
    this.pitch -= input.mouseDY * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Crouch Input (Control or KeyC)
    const kb = this.keybinds;
    const wantCrouch = input.keys[kb ? kb.get('crouch') : 'ControlLeft'] || input.keys['KeyC'];
    this.crouching = wantCrouch;

    // Smooth Eye Height Interpolation
    const targetHeight = this.crouching ? this.crouchHeight : this.standHeight;
    this.currentEyeHeight += (targetHeight - this.currentEyeHeight) * Math.min(1, 16 * dt);

    // Direction Vectors
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._moveDir.set(0, 0, 0);

    const fwd = kb ? kb.get('moveForward') : 'KeyW';
    const back = kb ? kb.get('moveBack') : 'KeyS';
    const right = kb ? kb.get('moveRight') : 'KeyD';
    const left = kb ? kb.get('moveLeft') : 'KeyA';
    if (input.keys[fwd] || input.keys['ArrowUp']) this._moveDir.add(this._forward);
    if (input.keys[back] || input.keys['ArrowDown']) this._moveDir.sub(this._forward);
    if (input.keys[right] || input.keys['ArrowRight']) this._moveDir.add(this._right);
    if (input.keys[left] || input.keys['ArrowLeft']) this._moveDir.sub(this._right);

    // Movement Speeds & Stance Restrictions
    const isMoving = this._moveDir.lengthSq() > 0;
    const sprintKey = kb ? kb.get('sprint') : 'ShiftLeft';
    const wantSprint = (input.keys[sprintKey] || input.keys['ShiftRight']) && isMoving && !this.crouching;
    this.sprinting = wantSprint && this.stamina > 0;

    let speedMult = 1.0;
    if (this.sprinting) speedMult = CONFIG.stamina.sprintMult;
    if (this.crouching) speedMult = 0.5; // Ducking pace

    // Adrenaline Syringe: +1.25x sprint speed while the boost is active.
    const adrenalineActive = this.adrenalineTimer > 0;
    if (this.sprinting && adrenalineActive) {
      speedMult *= CONFIG.perks.adrenaline.sprintMult;
    }

    const speed = CONFIG.player.speed * speedMult * this.slowFactor;
    if (isMoving) this._moveDir.normalize().multiplyScalar(speed);

    // Stamina Drain and Crouched Fast Recovery
    const now = performance.now() / 1000;
    if (this.sprinting) {
      // Adrenaline Syringe: no stamina drain while the boost is active.
      if (!adrenalineActive) {
        this.stamina = Math.max(0, this.stamina - CONFIG.stamina.drainRate * dt);
      }
      this.lastSprintTime = now;
    } else if (now - this.lastSprintTime > CONFIG.stamina.regenDelay) {
      // Ducking accelerates stamina recovery by 1.5x
      const regenRate = CONFIG.stamina.regenRate * (this.crouching ? 1.5 : 1.0);
      this.stamina = Math.min(this.maxStamina, this.stamina + regenRate * dt);
    }

    // Horizontal Inertia & Friction
    const friction = this.onGround ? (this.crouching ? 14 : 10) : 1.5;
    this.vel.x += (this._moveDir.x - this.vel.x) * Math.min(1, friction * dt);
    this.vel.z += (this._moveDir.z - this.vel.z) * Math.min(1, friction * dt);

    // Jump (Disabled while crouching)
    if (input.jumpPressed && this.onGround && !this.crouching) {
      this.vel.y = CONFIG.player.jumpVel;
      this.onGround = false;
    }

    // Gravity Application
    this.vel.y -= CONFIG.player.gravity * dt;

    // Horizontal Position Integration & World Collisions
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.resolveCollision(this.pos, CONFIG.player.radius);

    // Vertical Position Integration
    this.pos.y += this.vel.y * dt;

    // Vertical Stepping Kinematics
    const feetY = this.pos.y - this.standHeight;
    const groundY = this.world.getGroundHeight(this.pos.x, this.pos.z, feetY);

    // Auto-step up stairs without sliding down angled slopes
    if (this.onGround && groundY > feetY && groundY - feetY <= CONFIG.building.stepHeight + 0.05) {
      this.pos.y = groundY + this.standHeight;
      this.vel.y = 0;
    }

    // Ground Platform Landing
    if (this.pos.y <= this.standHeight + groundY) {
      this.pos.y = this.standHeight + groundY;
      this.vel.y = 0;
      if (!this.onGround) this.onGround = true;
    }

    // Position Camera with Dynamic Eye Height
    this.camera.position.set(this.pos.x, this.pos.y - (this.standHeight - this.currentEyeHeight), this.pos.z);

    // Q/E peek-lean: roll the camera Z-axis and shift horizontally.
    const leanL = kb ? kb.get('leanLeft') : 'KeyQ';
    const leanR = kb ? kb.get('leanRight') : 'KeyE';
    this.leanTarget = (input.keys[leanL] ? -1 : 0) + (input.keys[leanR] ? 1 : 0);
    const leanSpeed = CONFIG.player.lean.speed;
    this.leanAmount += (this.leanTarget - this.leanAmount) * Math.min(1, leanSpeed * dt);
    const lean = CONFIG.player.lean;
    this.camera.rotation.z = this.leanAmount * lean.maxTilt;
    // Shift the camera sideways along the right vector (perpendicular to view).
    this.camera.position.addScaledVector(this._right, this.leanAmount * lean.maxOffset);

    // Health Regeneration
    const now2 = performance.now() / 1000;
    if (this.alive && now2 - this.lastDamageTime > CONFIG.player.regenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + CONFIG.player.regenRate * dt);
    }

    // Adrenaline Syringe timer decay.
    if (this.adrenalineTimer > 0) {
      this.adrenalineTimer = Math.max(0, this.adrenalineTimer - dt);
    }

    // Viewmodel Bobbing
    const speed2d = Math.hypot(this.vel.x, this.vel.z);
    this.gunBob += dt * (this.onGround && speed2d > 0.5 ? 8 : 2);
    const bobY = Math.sin(this.gunBob) * 0.02 * Math.min(1, speed2d / 6);
    const bobX = Math.cos(this.gunBob * 0.5) * 0.015 * Math.min(1, speed2d / 6);

    if (this.weaponGroup) {
      this.weaponGroup.position.y = -0.3 + bobY;
      this.weaponGroup.position.x = 0.35 + bobX;
      this.weaponGroup.rotation.x = this.recoilOffset || 0;
    }
    if (this.recoilOffset) this.recoilOffset *= Math.max(0, 1 - 8 * dt);

    // Footstep Sound Radius & Events
    if (this.onGround && speed2d > 0.8) {
      this.stepTimer -= dt * speed2d;

      // Noise radii: Sprinting alerts wide area; crouching is silent.
      // Soft Soles perk halves footstep noise (sprint 18->9m, walk 5->2m).
      const soft = this.hasPerk && this.hasPerk('softSoles');
      if (this.sprinting) {
        this.noiseRadius = 18.0 * (soft ? CONFIG.perks.softSoles.sprintMult : 1);
      } else if (this.crouching) {
        this.noiseRadius = 0.0;
      } else {
        this.noiseRadius = 5.0 * (soft ? CONFIG.perks.softSoles.walkMult : 1);
      }

      if (this.stepTimer <= 0) {
        this.stepTimer = this.sprinting ? 0.32 : this.crouching ? 0.75 : 0.5;
        return this.crouching ? null : 'step';
      }
        } else {
          this.noiseRadius = 0;
        }

    return null;
  }

  applyRecoil(amount) {
    this.recoilOffset = (this.recoilOffset || 0) + 0.06;
    this.pitch += amount || 0.02;
  }
}
