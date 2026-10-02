// Weapon system: multiple switchable weapons (rifle, SMG, shotgun, sniper).
// Hitscan with tracers, per-weapon ammo, reload, and proper ray-sphere hit detection.

import * as THREE from 'three';
import { CONFIG } from './config.js?v=20261002c';

export class Weapon {
  constructor(scene, player, world, effects, audio, bots) {
    this.scene = scene;
    this.player = player;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.bots = bots;

    this.weaponKeys = Object.keys(CONFIG.weapons);
    this.currentIndex = 0;
    this.current = CONFIG.weapons[this.weaponKeys[0]];

    // Per-weapon ammo state
    this.ammo = {};
    for (const key of this.weaponKeys) {
      const w = CONFIG.weapons[key];
      this.ammo[key] = { mag: w.magSize, reserve: w.reserve };
    }

    // Weapons the player owns. Start with only the knife.
    this.owned = { knife: true };
    for (const key of this.weaponKeys) {
      if (!this.owned[key]) this.owned[key] = false;
    }

    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.meleeSwing = 0; // melee animation timer
    this.tracers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 });

    // Authoritative mode: the host resolves hits. Render-only clients (multiplayer)
    // send 'fire' actions to the host instead of damaging bots locally.
    this.authoritative = true;

    // Zoom state (sniper scope)
    this.zoomed = false;
    this.zoomAmount = 0; // 0 = not zoomed, 1 = fully zoomed
    this.baseFov = this.player.camera.fov;
    this.zoomFov = 20;

    // Viewmodels for each weapon, attached to camera
    this.viewmodels = {};
    for (const key of this.weaponKeys) {
      this.viewmodels[key] = this._buildViewmodel(key);
      this.player.camera.add(this.viewmodels[key]);
      this.viewmodels[key].visible = false;
    }
    this._showWeapon(this.currentIndex);
  }

  // Build a distinct viewmodel per weapon type.
  _buildViewmodel(key) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222a33, metalness: 0.6, roughness: 0.4 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.5, roughness: 0.5 });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

    if (key === 'rifle') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.5), bodyMat);
      body.position.z = -0.1;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), bodyMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.45);
      group.add(barrel);
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.2), accentMat);
      accent.position.set(0, 0.06, -0.1);
      group.add(accent);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.08), bodyMat);
      grip.position.set(0, -0.1, 0.1);
      grip.rotation.x = 0.3;
      group.add(grip);
    } else if (key === 'smg') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.4), darkMat);
      body.position.z = -0.05;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.4);
      group.add(barrel);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), bodyMat);
      mag.position.set(0, -0.12, -0.05);
      mag.rotation.x = 0.2;
      group.add(mag);
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.12), accentMat);
      accent.position.set(0, 0.05, -0.05);
      group.add(accent);
    } else if (key === 'shotgun') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.55), bodyMat);
      body.position.z = -0.1;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.03, -0.5);
      group.add(barrel);
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.2), darkMat);
      pump.position.set(0, -0.02, -0.35);
      group.add(pump);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.2), bodyMat);
      stock.position.set(0, -0.02, 0.25);
      stock.rotation.x = 0.2;
      group.add(stock);
    } else if (key === 'sniper') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), darkMat);
      body.position.z = -0.15;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.6);
      group.add(barrel);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), bodyMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.08, -0.1);
      group.add(scope);
      const scopeLens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 8), accentMat);
      scopeLens.position.set(0, 0.08, -0.2);
      group.add(scopeLens);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), bodyMat);
      grip.position.set(0, -0.1, 0.1);
      grip.rotation.x = 0.3;
      group.add(grip);
    } else if (key === 'knife') {
      // Knife: short blade + handle
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, metalness: 0.9, roughness: 0.2 });
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.35), bladeMat);
      blade.position.set(0, 0, -0.3);
      blade.rotation.x = 0.1;
      group.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6), bladeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(0, 0, -0.52);
      group.add(tip);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.15), darkMat);
      handle.position.set(0, 0, -0.08);
      group.add(handle);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), bodyMat);
      guard.position.set(0, 0, 0.02);
      group.add(guard);
    } else if (key === 'machete') {
      // Machete: long wide blade + handle
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e3, metalness: 0.9, roughness: 0.2 });
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.5), bladeMat);
      blade.position.set(0, 0, -0.4);
      blade.rotation.x = 0.15;
      group.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), bladeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(0, 0, -0.72);
      group.add(tip);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), darkMat);
      handle.position.set(0, 0, -0.1);
      group.add(handle);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), bodyMat);
      guard.position.set(0, 0, 0.02);
      group.add(guard);
    }

    group.position.set(0.35, -0.3, -0.6);
    group.rotation.y = 0.1;
    return group;
  }

  _showWeapon(index) {
    this.currentIndex = index;
    this.current = CONFIG.weapons[this.weaponKeys[index]];
    for (const key of this.weaponKeys) {
      this.viewmodels[key].visible = key === this.weaponKeys[index];
    }
    this.player.weaponGroup = this.viewmodels[this.weaponKeys[index]];
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.zoomed = false;
    this.meleeSwing = 0;
  }

  switchWeapon(delta) {
    // Cycle to the next OWNED weapon
    let next = this.currentIndex;
    for (let i = 0; i < this.weaponKeys.length; i++) {
      next = (next + delta + this.weaponKeys.length) % this.weaponKeys.length;
      if (this.owned[this.weaponKeys[next]]) break;
    }
    if (next !== this.currentIndex) {
      this._showWeapon(next);
      this.audio.reload();
    }
  }

  switchTo(key) {
    const idx = this.weaponKeys.indexOf(key);
    if (idx >= 0 && idx !== this.currentIndex && this.owned[key]) this._showWeapon(idx);
  }

  get currentAmmo() {
    return this.ammo[this.weaponKeys[this.currentIndex]];
  }

  reset() {
    for (const key of this.weaponKeys) {
      const w = CONFIG.weapons[key];
      this.ammo[key] = { mag: w.magSize, reserve: w.reserve };
    }
    // Start with only the knife
    this.owned = { knife: true };
    for (const key of this.weaponKeys) {
      if (!this.owned[key]) this.owned[key] = false;
    }
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    // Equip the knife
    this._showWeapon(this.weaponKeys.indexOf('knife'));
  }

  // Pick up a weapon (gun or melee). Returns true if newly acquired.
  pickupWeapon(key) {
    if (this.owned[key]) return false;
    this.owned[key] = true;
    this.switchTo(key);
    return true;
  }

  addAmmo(amount) {
    const a = this.currentAmmo;
    a.reserve = Math.min(CONFIG.weapons[this.weaponKeys[this.currentIndex]].reserve * 2, a.reserve + amount);
  }

  // Pick up a melee weapon (knife or machete).
  pickupMelee(key) {
    return this.pickupWeapon(key);
  }

  tryFire() {
    if (this.reloading || this.fireCooldown > 0) return false;

    // Melee weapons
    if (this.current.melee) {
      this.fireCooldown = this.current.fireRate;
      this.meleeSwing = 1;
      this.player.applyRecoil(this.current.recoil);
      this.audio.melee();
      return this._meleeAttack();
    }

    const a = this.currentAmmo;
    if (a.mag <= 0) {
      this.audio.empty();
      this.startReload();
      return false;
    }
    a.mag--;
    this.fireCooldown = this.current.fireRate;
    this.player.applyRecoil(this.current.recoil);
    // Per-weapon sound
    if (this.current.name === 'SNIPER') this.audio.sniperShot();
    else if (this.current.name === 'SHOTGUN') this.audio.shotgunShot();
    else this.audio.shoot();
    this.effects.muzzleFlash(this.player.getMuzzleWorldPos());

    // Shotgun fires multiple pellets
    let result = { type: 'miss' };
    for (let i = 0; i < this.current.pellets; i++) {
      const r = this._fireRay();
      if (r.type !== 'miss') result = r;
    }
    return result;
  }

  // Melee attack: check for a bot within range in front of the player.
  _meleeAttack() {
    const origin = this.player.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3();
    this.player.camera.getWorldDirection(dir);
    const range = this.current.range;

    let best = null;
    let bestDist = range;
    for (const bot of this.scene.userData.bots || []) {
      if (!bot.alive) continue;
      const center = bot.pos.clone().add(new THREE.Vector3(0, 1.0, 0));
      const toBot = center.clone().sub(origin);
      const dist = toBot.length();
      if (dist > bestDist) continue;
      const t = toBot.clone().normalize().dot(dir);
      if (t > 0.6) {
        const closest = origin.clone().addScaledVector(dir, dist * t);
        if (closest.distanceTo(center) < 1.0) {
          best = { bot, dist };
          bestDist = dist;
        }
      }
    }

    if (best) {
      // Render-only clients don't resolve melee locally — the host does.
      if (!this.authoritative) return { type: 'miss' };
      this.bots.damage(best.bot, this.current.damage, this.player);
      this.effects.impact(best.bot.pos.clone().add(new THREE.Vector3(0, 1, 0)), dir);
      // Silent takedown: stab weapons get a fleshy slit/whoosh instead of a generic hit.
      if (this.current.meleeType === 'stab') this.audio.stealthStab();
      else this.audio.hit();
      return { type: 'bot', killed: !best.bot.alive };
    }
    return { type: 'miss' };
  }

  // --- Zoom (sniper scope) ---
  setZoom(on) {
    // Only the sniper can zoom
    if (this.current.name !== 'SNIPER') {
      this.zoomed = false;
      return;
    }
    this.zoomed = on;
  }

  updateZoom(dt) {
    const target = this.zoomed ? 1 : 0;
    // Smooth zoom animation
    const speed = this.zoomed ? 8 : 6;
    this.zoomAmount += (target - this.zoomAmount) * Math.min(1, speed * dt);
    if (Math.abs(this.zoomAmount - target) < 0.01) this.zoomAmount = target;

    // Base FOV respects the adrenaline tunnel-vision expansion set by main.js.
    // The game stores the current dynamic FOV on the player for us to read.
    const dynamicBase = this.player.camera.userData.dynamicFov || this.baseFov;
    const fov = dynamicBase + (this.zoomFov - dynamicBase) * this.zoomAmount;
    if (Math.abs(this.player.camera.fov - fov) > 0.01) {
      this.player.camera.fov = fov;
      this.player.camera.updateProjectionMatrix();
    }
  }

  // Sniper scope detection: while zoomed, infected bots under the crosshair
  // get revealed (visor glow + reveal ring) so you can spot "the other" from a rooftop.
  updateScopeDetection() {
    // Only active when fully zoomed with the sniper.
    if (this.current.name !== 'SNIPER' || this.zoomAmount < 0.9) return;

    const origin = this.player.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3();
    this.player.camera.getWorldDirection(dir);

    const bots = this.scene.userData.bots || [];
    for (const bot of bots) {
      if (!bot.alive || !bot.infected) continue;
      const center = bot.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
      const toBot = center.clone().sub(origin);
      const dist = toBot.length();
      if (dist > 60) continue; // scope range
      const t = toBot.clone().normalize().dot(dir);
      // Narrow cone — must be looking almost directly at them.
      if (t > 0.995) {
        // Reveal the infected: visor glow + reveal ring + spotlight lock.
        // The visor only glows at night — during the day the scope reveal is
        // the pink ring + spotlight lock instead (visor stays dark).
        bot.revealed = CONFIG.spotlight.revealDuration;
        if (this.world.revealBot) this.world.revealBot(bot);
        if (bot.parts && bot.parts.visor) {
          const night = this.world.isNight ? this.world.isNight() : true;
          bot.parts.visor.visible = night;
          bot.parts.visor.material.color.setHex(0x00ff88);
          bot.parts.visor.material.emissive.setHex(0x00ff88);
        }
      }
    }
  }

  _fireRay() {
    const origin = this.player.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3();
    this.player.camera.getWorldDirection(dir);
    const spread = this.current.spread;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const end = origin.clone().addScaledVector(dir, this.current.range);
    let hit = null;
    let hitDist = this.current.range;

    // Check bots — proper ray-sphere test against the body center (mid-torso).
    // The bot body spans roughly y=0.86 (hips) to y=2.1 (helmet), so center ~1.5.
    const bodyCenter = new THREE.Vector3(0, 1.5, 0);
    const bodyRadius = 0.7;
    for (const bot of this.scene.userData.bots || []) {
      if (!bot.alive) continue;
      const center = bot.pos.clone().add(bodyCenter);
      const toCenter = center.clone().sub(origin);
      const dist = toCenter.length();
      if (dist > hitDist) continue;
      const t = toCenter.clone().normalize().dot(dir);
      if (t > 0) {
        const closest = origin.clone().addScaledVector(dir, dist * t);
        const closestDist = closest.distanceTo(center);
        if (closestDist < bodyRadius) {
          hit = { type: 'bot', bot, dist: dist * t };
          hitDist = dist * t;
        }
      }
    }

    // Check crates
    for (const c of this.world.crates) {
      if (!c.alive) continue;
      const toCrate = c.mesh.position.clone().sub(origin);
      const dist = toCrate.length();
      if (dist > hitDist) continue;
      const t = toCrate.clone().normalize().dot(dir);
      if (t > 0.9) {
        const closest = origin.clone().addScaledVector(dir, dist * t);
        if (closest.distanceTo(c.mesh.position) < 1.4) {
          hit = { type: 'crate', crate: c, dist };
          hitDist = dist;
        }
      }
    }

    // Check buildings (raycast against obstacle AABBs)
    const buildingHit = this._raycastBuildings(origin, dir, hitDist);
    if (buildingHit) {
      hit = { type: 'building', point: buildingHit.point, normal: buildingHit.normal, dist: buildingHit.dist };
      hitDist = buildingHit.dist;
    }

    // Spawn tracer
    const tracerEnd = hit ? origin.clone().addScaledVector(dir, hitDist) : end;
    this._spawnTracer(origin, tracerEnd, this.current.tracerColor);

    // Apply hit
    if (hit) {
      if (hit.type === 'bot') {
        // Render-only clients don't resolve hits locally — the host does.
        if (!this.authoritative) return { type: 'bot', killed: false };
        this.bots.damage(hit.bot, this.current.damage, this.player);
        this.effects.impact(hit.bot.pos.clone().add(new THREE.Vector3(0, 1, 0)), dir);
        this.audio.hit();
        return { type: 'bot', killed: !hit.bot.alive };
      } else if (hit.type === 'crate') {
        const destroyed = this.world.damageCrateAt(hit.crate.mesh.position, this.effects);
        if (destroyed) this.audio.explosion();
        else this.effects.impact(hit.crate.mesh.position.clone(), dir);
        return { type: 'crate', destroyed };
      } else if (hit.type === 'building') {
        this.effects.impact(hit.point, hit.normal);
        return { type: 'building' };
      }
    }
    return { type: 'miss' };
  }

  _raycastBuildings(origin, dir, maxDist) {
    let best = null;
    for (const o of this.world.obstacles) {
      if (o.crate) continue; // crates handled separately
      const t = this._rayAABB(origin, dir, o);
      if (t !== null && t < maxDist) {
        if (!best || t < best.dist) {
          const point = origin.clone().addScaledVector(dir, t);
          best = { point, dist: t, normal: new THREE.Vector3(0, 1, 0) };
        }
      }
    }
    return best;
  }

  _rayAABB(origin, dir, box) {
    let tmin = -Infinity, tmax = Infinity;
    const mins = [box.minX, 0, box.minZ];
    const maxs = [box.maxX, box.height, box.maxZ];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir.getComponent(i)) < 1e-8) {
        if (origin.getComponent(i) < mins[i] || origin.getComponent(i) > maxs[i]) return null;
      } else {
        let t1 = (mins[i] - origin.getComponent(i)) / dir.getComponent(i);
        let t2 = (maxs[i] - origin.getComponent(i)) / dir.getComponent(i);
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin > 0 ? tmin : null;
  }

  _spawnTracer(start, end, color) {
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  startReload() {
    if (this.current.melee) return; // melee weapons don't reload
    const a = this.currentAmmo;
    if (this.reloading || a.mag >= this.current.magSize || a.reserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = this.current.reloadTime;
    this.audio.reload();
  }

  update(dt) {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    this.updateZoom(dt);

    // Sniper scope: reveal infected bots under the crosshair.
    this.updateScopeDetection();

    // Melee swing animation
    if (this.meleeSwing > 0) {
      this.meleeSwing = Math.max(0, this.meleeSwing - dt * 4);
      const vm = this.viewmodels[this.weaponKeys[this.currentIndex]];
      if (vm) {
        const swing = Math.sin(this.meleeSwing * Math.PI);
        if (this.current.meleeType === 'stab') {
          vm.position.z = -0.6 - swing * 0.4;
        } else {
          vm.rotation.z = swing * 1.2;
        }
      }
    }

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const a = this.currentAmmo;
        const need = this.current.magSize - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
        this.reloading = false;
      }
    }
    // Update tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  dispose() {
    this.tracerMat.dispose();
  }
}
