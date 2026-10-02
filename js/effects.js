// Particles, explosions, impact sparks, deduction FX, and screen shake.

import * as THREE from 'three';
import { CONFIG } from './config.js?v=20261002c';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.rings = [];
    this.shake = 0;

    // Shared base geometries
    this.geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.ringGeo = new THREE.RingGeometry(0.2, 0.35, 24);

    // Shared particle materials
    this.mats = {
      spark: new THREE.MeshBasicMaterial({ color: 0xffd166 }),
      debris: new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.8 }),
      blood: new THREE.MeshBasicMaterial({ color: 0x8a0303 }),
      smoke: new THREE.MeshBasicMaterial({ color: 0x444444 }),
      muzzle: new THREE.MeshBasicMaterial({ color: 0xffaa33 }),
      infect: new THREE.MeshBasicMaterial({ color: 0x3bff8a }),
      tagRing: new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide }),
    };

    // Pre-allocated vectors for math operations to prevent GC pressure
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  addShake(amount) {
    this.shake = Math.min(this.shake + amount, 1.2);
  }

  spawn(pos, vel, color, life = 0.6, size = 0.12, gravity = 1) {
    if (this.particles.length >= CONFIG.effects.maxParticles) {
      // Recycle oldest particle: remove from scene without disposing shared geometry
      const old = this.particles.shift();
      this.scene.remove(old.mesh);
    }

    const mat = this.mats[color] || this.mats.spark;
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);

    this.particles.push({
      mesh,
      vel: vel.clone(),
      life,
      maxLife: life,
      initialSize: size,
      gravity,
    });
  }

  // Directional wall/surface ricochet using impact plane normal
  impact(pos, normal) {
    const baseNormal = normal ? this._v1.copy(normal).normalize() : this._v1.set(0, 1, 0);

    for (let i = 0; i < 8; i++) {
      this._v2.set(
        (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.5) * 2.2
      );

      const vel = baseNormal.clone().multiplyScalar(3.0 + Math.random() * 2.5).add(this._v2);
      this.spawn(pos, vel, 'spark', 0.25 + Math.random() * 0.15, 0.08, 0.8);
    }
  }

  muzzleFlash(pos) {
    for (let i = 0; i < 4; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5
      );
      this.spawn(pos, vel, 'muzzle', 0.06, 0.14, 0);
    }
  }

  explosion(pos, color = 'spark', count = 24, power = 8) {
    for (let i = 0; i < count; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * power,
        Math.random() * power * 0.8,
        (Math.random() - 0.5) * power
      );
      this.spawn(pos, vel, color, 0.5 + Math.random() * 0.4, 0.1 + Math.random() * 0.15, 1);
    }

    // Upward-drifting smoke cloud
    for (let i = 0; i < 6; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 1.8,
        1.5 + Math.random() * 2.0,
        (Math.random() - 0.5) * 1.8
      );
      this.spawn(pos, vel, 'smoke', 1.0, 0.35, -0.2);
    }
  }

  // Low-profile silent kill effect: compact blood droplets, minimal spread
  stealthKill(pos) {
    for (let i = 0; i < 10; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 1.2,
        0.5 + Math.random() * 1.0,
        (Math.random() - 0.5) * 1.2
      );
      this.spawn(pos, vel, 'blood', 0.4 + Math.random() * 0.2, 0.07, 1.2);
    }
  }

  // Visual tell when an NPC is converted: subtle rising wisps
  infectionTaint(pos) {
    for (let i = 0; i < 6; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        1.0 + Math.random() * 0.8,
        (Math.random() - 0.5) * 0.6
      );
      this.spawn(pos, vel, 'infect', 0.7, 0.09, -0.3);
    }
  }

  // Expanding ground marker pulse for identified suspects
  tagBeacon(pos) {
    const mesh = new THREE.Mesh(this.ringGeo, this.mats.tagRing);
    mesh.position.set(pos.x, 0.05, pos.z);
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);

    this.rings.push({
      mesh,
      life: 0.8,
      maxLife: 0.8,
      scale: 1.0,
    });
  }

  update(dt) {
    // Screen shake decay
    this.shake = Math.max(0, this.shake - CONFIG.effects.shakeDecay * dt);

    // Particle update cycle
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }

      // Physics integration
      p.vel.y -= 9.8 * p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);

      // Smooth decay without modifying shared material properties
      const lifeRatio = Math.max(0.01, p.life / p.maxLife);
      p.mesh.scale.setScalar(p.initialSize * lifeRatio);
    }

    // Tag ring ground pulse expansion
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;

      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        this.rings.splice(i, 1);
        continue;
      }

      r.scale += dt * 3.5;
      r.mesh.scale.setScalar(r.scale);
    }
  }

  dispose() {
    for (const p of this.particles) this.scene.remove(p.mesh);
    for (const r of this.rings) this.scene.remove(r.mesh);

    this.particles = [];
    this.rings = [];

    this.geo.dispose();
    this.ringGeo.dispose();
    Object.values(this.mats).forEach((m) => m.dispose());
  }
}
