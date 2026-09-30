// First-person player controller: movement, camera, look, health.

import * as THREE from 'three';
import { CONFIG } from './config.js';

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3(0, CONFIG.player.height, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = CONFIG.player.maxHealth;
    this.maxHealth = CONFIG.player.maxHealth;
    this.onGround = true;
    this.lastDamageTime = -999;
    this.keys = {};
    this.sprinting = false;
    this.stepTimer = 0;
    this.alive = true;
    // Stamina
    this.stamina = CONFIG.stamina.max;
    this.maxStamina = CONFIG.stamina.max;
    this.lastSprintTime = -999;
    // Low-health slow factor (1 = full speed, lower = slower)
    this.slowFactor = 1;

    this.gunBob = 0;
    this.recoilOffset = 0;
  }

  setSlowFactor(healthRatio) {
    // Slow down as health drops below 50%; floor at 0.6x speed.
    this.slowFactor = healthRatio > 0.5 ? 1 : Math.max(0.6, 0.5 + healthRatio);
  }

  reset() {
    this.pos.set(0, CONFIG.player.height, 0);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.lastDamageTime = -999;
    this.recoilOffset = 0;
    this.stamina = this.maxStamina;
    this.lastSprintTime = -999;
  }

  getMuzzleWorldPos() {
    // Muzzle is ~0.6 units in front of the camera at chest height.
    const v = new THREE.Vector3(0, 0, -0.6);
    return this.camera.localToWorld(v.clone());
  }

  damage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastDamageTime = performance.now() / 1000;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  heal(amount) {
    if (!this.alive) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  update(dt, input) {
    if (!this.alive) return;

    // Look
    this.yaw -= input.mouseDX * 0.0022;
    this.pitch -= input.mouseDY * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Movement direction
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (input.keys['KeyW'] || input.keys['ArrowUp']) move.add(forward);
    if (input.keys['KeyS'] || input.keys['ArrowDown']) move.sub(forward);
    if (input.keys['KeyD'] || input.keys['ArrowRight']) move.add(right);
    if (input.keys['KeyA'] || input.keys['ArrowLeft']) move.sub(right);

    // Sprint with stamina
    const wantSprint = (input.keys['ShiftLeft'] || input.keys['ShiftRight']) && move.lengthSq() > 0;
    this.sprinting = wantSprint && this.stamina > 0;
    const speed = CONFIG.player.speed * (this.sprinting ? CONFIG.stamina.sprintMult : 1) * this.slowFactor;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

    // Stamina drain/regen
    const now = performance.now() / 1000;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - CONFIG.stamina.drainRate * dt);
      this.lastSprintTime = now;
    } else if (now - this.lastSprintTime > CONFIG.stamina.regenDelay) {
      this.stamina = Math.min(this.maxStamina, this.stamina + CONFIG.stamina.regenRate * dt);
    }

    // Horizontal velocity with friction
    const friction = this.onGround ? 10 : 1.5;
    this.vel.x += (move.x - this.vel.x) * Math.min(1, friction * dt);
    this.vel.z += (move.z - this.vel.z) * Math.min(1, friction * dt);

    // Jump
    if (input.jumpPressed && this.onGround) {
      this.vel.y = CONFIG.player.jumpVel;
      this.onGround = false;
    }

    // Gravity
    this.vel.y -= CONFIG.player.gravity * dt;

    // Integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.world.resolveCollision(this.pos, CONFIG.player.radius);

    this.pos.y += this.vel.y * dt;

    // Ground/platform height at current position (only step onto reachable platforms)
    const feetY = this.pos.y - CONFIG.player.height;
    const groundY = this.world.getGroundHeight(this.pos.x, this.pos.z, feetY);

    // Auto-step up stairs/platforms (if the step is small enough).
    // Smoothly ease the player up rather than snapping, to avoid jitter.
    if (this.onGround && groundY > feetY && groundY - feetY <= CONFIG.building.stepHeight) {
      const targetY = groundY + CONFIG.player.height;
      const diff = targetY - this.pos.y;
      // Move up quickly but smoothly (fast enough to feel responsive, slow enough to avoid jitter)
      this.pos.y += diff * Math.min(1, 14 * dt);
      this.vel.y = 0;
    }

    // Land on ground or platform
    if (this.pos.y <= CONFIG.player.height + groundY) {
      this.pos.y = CONFIG.player.height + groundY;
      this.vel.y = 0;
      if (!this.onGround) this.onGround = true;
    }

    this.camera.position.copy(this.pos);

    // Health regen
    const now2 = performance.now() / 1000;
    if (this.alive && now2 - this.lastDamageTime > CONFIG.player.regenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + CONFIG.player.regenRate * dt);
    }

    // Weapon bob & recoil recovery
    const speed2d = Math.hypot(this.vel.x, this.vel.z);
    this.gunBob += dt * (this.onGround && speed2d > 0.5 ? 8 : 2);
    const bobY = Math.sin(this.gunBob) * 0.02 * Math.min(1, speed2d / 6);
    const bobX = Math.cos(this.gunBob * 0.5) * 0.015 * Math.min(1, speed2d / 6);
    // Animate the active weapon viewmodel (set by the Weapon class)
    if (this.weaponGroup) {
      this.weaponGroup.position.y = -0.3 + bobY;
      this.weaponGroup.position.x = 0.35 + bobX;
      this.weaponGroup.rotation.x = this.recoilOffset || 0;
    }
    if (this.recoilOffset) this.recoilOffset *= Math.max(0, 1 - 8 * dt);

    // Footsteps
    if (this.onGround && speed2d > 1) {
      this.stepTimer -= dt * speed2d;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.5;
        return 'step';
      }
    }
    return null;
  }

  applyRecoil(amount) {
    this.recoilOffset = (this.recoilOffset || 0) + 0.06;
    this.pitch += amount || 0.02;
  }
}
