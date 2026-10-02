// Health, ammo, melee weapon pickups, and enemy drops.

import * as THREE from 'three';
import { CONFIG } from './config.js?v=20261002d';

export class Pickups {
  constructor(scene, world, audio, onPickup) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.onPickup = onPickup || null;
    this.pickups = [];
    // Render-only clients (multiplayer) don't collect locally — they send a
    // 'collect' action to the host, which resolves and broadcasts the result.
    this.renderOnly = false;
    this._buildMeshes();
  }

  _buildMeshes() {
    this.healthMat = new THREE.MeshStandardMaterial({ color: 0x3bff8a, emissive: 0x3bff8a, emissiveIntensity: 0.4 });
    this.ammoMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.4 });
    this.knifeMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, metalness: 0.9, roughness: 0.2 });
    this.macheteMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, metalness: 0.9, roughness: 0.2 });
    this.handleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
    // Gun pickup materials (distinct colors per gun)
    this.gunMats = {
      rifle: new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.6, roughness: 0.4 }),
      smg: new THREE.MeshStandardMaterial({ color: 0x3a2a1a, metalness: 0.5, roughness: 0.5 }),
      shotgun: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, metalness: 0.5, roughness: 0.5 }),
      sniper: new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.7, roughness: 0.3 }),
    };
    // Perk pickup materials (distinct colors per perk)
    this.perkMats = {
      sixthSense: new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 0.5 }),
      thermal: new THREE.MeshStandardMaterial({ color: 0xff2d78, emissive: 0xff2d78, emissiveIntensity: 0.5 }),
      softSoles: new THREE.MeshStandardMaterial({ color: 0x9b9bff, emissive: 0x9b9bff, emissiveIntensity: 0.5 }),
      adrenaline: new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.5 }),
    };
    // Beam colors matching each perk so the light column reads as the same item.
    this.perkBeamColors = {
      sixthSense: 0x00e5ff,
      thermal: 0xff2d78,
      softSoles: 0x9b9bff,
      adrenaline: 0xffd166,
    };
  }

  spawnAll() {
    // Clear any leftover pickups from a previous run (restart safety).
    this.clearAll();
    for (let i = 0; i < CONFIG.pickupCount; i++) {
      this.spawnPickup();
    }
    // Spawn weapon pickups (guns + machete) scattered on the map
    const counts = CONFIG.weaponPickup;
    for (const key of ['rifle', 'smg', 'shotgun', 'sniper', 'machete']) {
      const count = counts[key + 'Count'] || 0;
      for (let i = 0; i < count; i++) {
        this.spawnWeaponPickup(key);
      }
    }
    // Spawn the four sensory perks (one of each, hidden in the environment).
    for (const key of ['sixthSense', 'thermal', 'softSoles', 'adrenaline']) {
      this.spawnPerkPickup(key);
    }
  }

  // Remove all pickups from the scene (called on restart).
  clearAll() {
    for (const p of this.pickups) {
      if (p.mesh.parent) this.scene.remove(p.mesh);
      if (p.beam && p.beam.parent) this.scene.remove(p.beam);
    }
    this.pickups = [];
  }

  // Add a tall glowing light beam above a pickup so it's easy to spot from
  // across the map (the whole point of loot is that you can FIND it).
  _addBeam(x, z, color) {
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 14, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(x, 8, z);
    this.scene.add(beam);
    return beam;
  }

  // Spawn a weapon pickup (gun or machete) on the map.
  spawnWeaponPickup(key) {
    let x, z, attempts = 0;
    const rnd = this.world._rand || Math.random;
    do {
      x = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      z = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      attempts++;
    } while (this.world.collides(x, z, 0.6) && attempts < 50);

    const group = new THREE.Group();
    if (key === 'machete') {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.6), this.macheteMat);
      blade.position.z = -0.3;
      group.add(blade);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), this.handleMat);
      handle.position.z = 0.1;
      group.add(handle);
    } else {
      // Gun pickup: simple gun shape
      const mat = this.gunMats[key];
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), mat);
      body.position.z = -0.1;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), mat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.4);
      group.add(barrel);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), mat);
      grip.position.set(0, -0.1, 0.1);
      grip.rotation.x = 0.3;
      group.add(grip);
    }
    group.position.set(x, 1.2, z);
    this.scene.add(group);

    this.pickups.push({
      type: 'weapon',
      weaponKey: key,
      mesh: group,
      beam: this._addBeam(x, z, 0x00e5ff),
      pos: new THREE.Vector3(x, 1.2, z),
      active: true,
      respawnTimer: 0,
    });
  }

  spawnPickup() {
    const rnd = this.world._rand || Math.random;
    const type = rnd() < 0.5 ? 'health' : 'ammo';
    let x, z, attempts = 0;
    do {
      x = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      z = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      attempts++;
    } while (this.world.collides(x, z, 0.6) && attempts < 50);

    const mat = type === 'health' ? this.healthMat : this.ammoMat;
    const geo = new THREE.OctahedronGeometry(0.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 1.2, z);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.pickups.push({
      type,
      mesh,
      beam: this._addBeam(x, z, type === 'health' ? 0x3bff8a : 0xffd166),
      pos: new THREE.Vector3(x, 1.2, z),
      active: true,
      respawnTimer: 0,
    });
  }

  // Spawn a melee weapon pickup (knife or machete).
  spawnMeleePickup(key) {
    let x, z, attempts = 0;
    const rnd = this.world._rand || Math.random;
    do {
      x = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      z = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      attempts++;
    } while (this.world.collides(x, z, 0.6) && attempts < 50);

    const group = new THREE.Group();
    const bladeMat = key === 'knife' ? this.knifeMat : this.macheteMat;
    const bladeLen = key === 'knife' ? 0.4 : 0.6;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, bladeLen), bladeMat);
    blade.position.z = -bladeLen / 2;
    group.add(blade);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), this.handleMat);
    handle.position.z = 0.1;
    group.add(handle);
    group.position.set(x, 1.2, z);
    this.scene.add(group);

    this.pickups.push({
      type: 'melee',
      meleeKey: key,
      mesh: group,
      beam: this._addBeam(x, z, 0x00e5ff),
      pos: new THREE.Vector3(x, 1.2, z),
      active: true,
      respawnTimer: 0,
    });
  }

  // Spawn a sensory perk pickup (Sixth Sense, Thermal, Soft Soles, Adrenaline).
  // Perks are hidden in the environment — car trunks, closets, dressers,
  // cabinets, crates — so they read as physical discoveries, not baseline
  // abilities. They use a small glowing capsule mesh with a colored beam.
  spawnPerkPickup(key) {
    let x, z, attempts = 0;
    const rnd = this.world._rand || Math.random;
    do {
      x = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      z = (rnd() * 2 - 1) * (CONFIG.worldSize - 15);
      attempts++;
    } while (this.world.collides(x, z, 0.6) && attempts < 50);

    const mat = this.perkMats[key] || this.healthMat;
    const geo = new THREE.CapsuleGeometry(0.18, 0.35, 6, 12);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 1.2, z);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.pickups.push({
      type: 'perk',
      perkKey: key,
      mesh,
      beam: this._addBeam(x, z, this.perkBeamColors[key] || 0xffffff),
      pos: new THREE.Vector3(x, 1.2, z),
      active: true,
      respawnTimer: 0,
    });
  }

  // Drop an item at a position (used when a bot dies).
  dropAt(pos, type) {
    const mat = type === 'health' ? this.healthMat : this.ammoMat;
    const geo = new THREE.OctahedronGeometry(0.4);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.position.y = 0.6;
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.pickups.push({
      type,
      mesh,
      beam: this._addBeam(pos.x, pos.z, type === 'health' ? 0x3bff8a : 0xffd166),
      pos: pos.clone(),
      active: true,
      respawnTimer: 0,
      isDrop: true,
    });
  }

  update(dt, player, weapon) {
    for (const p of this.pickups) {
      if (!p.active) {
        // Render-only clients don't run respawn timers — the host broadcasts
        // when a pickup comes back.
        if (this.renderOnly) continue;
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.active = true;
          p.mesh.visible = true;
          if (p.beam) p.beam.visible = true;
        }
        continue;
      }
      // Rotate & bob
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 1.2 + Math.sin(performance.now() / 400) * 0.15;

      // Collect — render-only clients send the request to the host instead.
      const dist = p.pos.distanceTo(player.pos);
      if (dist < 1.5 && player.alive) {
        if (this.renderOnly) {
          if (this.onCollect) this.onCollect(p);
          continue;
        }
        let label = null;
        if (p.type === 'health') {
          player.heal(CONFIG.pickup.healthAmount);
          label = '+HEALTH';
        } else if (p.type === 'ammo') {
          weapon.addAmmo(CONFIG.pickup.ammoAmount);
          label = '+AMMO';
        } else if (p.type === 'weapon') {
          const picked = weapon.pickupWeapon(p.weaponKey);
          if (!picked) continue; // already own it, leave it
          label = CONFIG.weapons[p.weaponKey].name + ' ACQUIRED';
        } else if (p.type === 'perk') {
          // Sensory perk discovered in the environment.
          const gained = player.addPerk(p.perkKey);
          if (!gained) continue; // already own it, leave it
          label = this._perkLabel(p.perkKey);
        }
        this.audio.pickup();
        if (this.onPickup && label) this.onPickup(label);
        p.active = false;
        p.mesh.visible = false;
        if (p.beam) p.beam.visible = false;
        p.respawnTimer = p.isDrop ? 9999 : CONFIG.pickup.respawnTime;
      }
    }
  }

  // Friendly HUD label for a discovered sensory perk.
  _perkLabel(key) {
    switch (key) {
      case 'sixthSense': return 'SIXTH SENSE ACQUIRED — NEURAL RADAR ONLINE';
      case 'thermal': return 'THERMAL SCANNER ACQUIRED — MICRO-TELLS VISIBLE';
      case 'softSoles': return 'SOFT SOLES ACQUIRED — FOOTSTEPS HALVED';
      case 'adrenaline': return 'ADRENALINE SYRINGE — SPRINT BOOSTED';
      default: return 'PERK ACQUIRED';
    }
  }

  dispose() {
    this.healthMat.dispose();
    this.ammoMat.dispose();
    this.knifeMat.dispose();
    this.macheteMat.dispose();
    this.handleMat.dispose();
    Object.values(this.gunMats).forEach((m) => m.dispose());
    Object.values(this.perkMats).forEach((m) => m.dispose());
  }
}
