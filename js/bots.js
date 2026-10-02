// AI bots: patrol, chase, and shoot the player.

import * as THREE from 'three';
import { CONFIG, WORLD_HALF } from './config.js';
import { generateFabricTexture, generateNormalMap } from './textures.js';

// Civilian archetypes — distinct personalities for uninfected NPCs.
export const BOT_ARCHETYPES = {
  COMMUTER: 'commuter',
  LOITERER: 'loiterer',
  NERVOUS: 'nervous',
  MIMIC: 'mimic',
};

// Infected hunter roles — distinct tactical jobs for converted bots.
export const INFECTED_ROLES = {
  STALKER: 'stalker',   // Patient Zero / stealth assimilator
  FLANKER: 'flanker',   // Cuts off escapes via alleys/doors
  RUSHER: 'rusher',     // Aggressive direct pursuer
};

export class Bots {
  constructor(scene, world, effects, audio, onKill, onDrop, onPlayerDamage, onCivilianKilled) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.onKill = onKill || null;
    this.onDrop = onDrop || null;
    this.onPlayerDamage = onPlayerDamage || null;
    this.onCivilianKilled = onCivilianKilled || null;
    this.bots = [];
    this.scene.userData.bots = this.bots;
    this.spawnTimer = 0;
    // Render-only mode (multiplayer client): the host runs the simulation and
    // broadcasts state snapshots. The client only animates what it receives.
    this.renderOnly = false;
    // Global infection rate limiter: caps how many NEW infections can happen
    // per second across ALL infected combined. Without this, N infected each
    // infecting every T seconds snowballs exponentially and wipes the map.
    this.infectionBudget = 0;
    this._buildMeshes();
  }

  _buildMeshes() {
    // --- Shared geometries (built ONCE, reused by every NPC) ---
    // This is critical for memory: no per-NPC geometry allocation.
    this.geo = {
      torso: new THREE.CylinderGeometry(0.28, 0.22, 0.75, 10),
      pelvis: new THREE.CylinderGeometry(0.24, 0.26, 0.28, 10),
      head: new THREE.SphereGeometry(0.18, 12, 10),
      hair: new THREE.SphereGeometry(0.19, 12, 10),
      upperArm: new THREE.CapsuleGeometry(0.09, 0.42, 6, 10),
      foreArm: new THREE.CapsuleGeometry(0.08, 0.38, 6, 10),
      thigh: new THREE.CapsuleGeometry(0.1, 0.42, 6, 10),
      shin: new THREE.CapsuleGeometry(0.09, 0.42, 6, 10),
      foot: new THREE.BoxGeometry(0.14, 0.08, 0.24),
      visor: new THREE.BoxGeometry(0.24, 0.06, 0.04),
      ring: new THREE.RingGeometry(0.55, 0.75, 20),
    };

    // --- Procedural fabric noise texture generator (built once per color) ---
    this._makeFabricTexture = (baseColor) => {
      const size = 64; // smaller texture = less memory
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, 0, size, size);
      const img = ctx.getImageData(0, 0, size, size);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 18;
        d[i] = Math.max(0, Math.min(255, d[i] + n));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
      }
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
      return tex;
    };

    // --- Shared materials (built once, reused by every NPC) ---
    // Desaturated cinematic earth tones with woven fabric + normal maps.
    const shirtColors = ['#4a4740', '#2d3436', '#636e72', '#303952', '#3d3a34', '#4a3a2a', '#2f3640', '#5a4a3a'];
    this.shirtMats = shirtColors.map((c) => new THREE.MeshStandardMaterial({
      map: generateFabricTexture(c, 14),
      normalMap: generateNormalMap(18),
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.85,
      metalness: 0.05,
    }));
    const pantsColors = ['#2a2a30', '#2e2a28', '#262a26', '#2c2c28'];
    this.pantsMats = pantsColors.map((c) => new THREE.MeshStandardMaterial({
      map: generateFabricTexture(c, 12),
      normalMap: generateNormalMap(16),
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.9,
      metalness: 0.03,
    }));
    this.skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a06b, roughness: 0.8 });
    this.hairMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
    this.shoeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    // The "other" (infected) gets a subtle corrupted visor tint.
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    // Shared reveal ring material.
    this.ringMat = new THREE.MeshBasicMaterial({
      color: CONFIG.spotlight.revealColor,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
    });
  }

  // Build a low-poly casual civilian with anatomical proportions.
  // Returns { group, parts } where parts holds named meshes for animation.
  _buildHumanoid() {
    const group = new THREE.Group();
    const parts = {};

    // Random clothing colors so everyone looks like a random person on the street.
    const shirtMat = this.shirtMats[Math.floor(Math.random() * this.shirtMats.length)];
    const pantsMat = this.pantsMats[Math.floor(Math.random() * this.pantsMats.length)];

    // --- Torso (segmented chest + waist, tapered cylinders) ---
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.35, 12), pantsMat);
    pelvis.position.y = 1.0;
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.42, 12), shirtMat);
    chest.position.y = 1.32;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.35, 12), shirtMat);
    torso.position.y = 1.62;
    group.add(pelvis, chest, torso);

    // --- Head (scaled sphere) + hair ---
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 14), this.skinMat);
    head.scale.set(0.9, 1.15, 1.0);
    head.position.y = 1.95;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), this.hairMat);
    hair.scale.set(1.0, 0.5, 1.0);
    hair.position.y = 2.08;
    // A subtle visor that only lights up when infected ("the other").
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.04), this.visorMat);
    visor.position.set(0, 1.97, -0.16);
    visor.visible = false;
    group.add(head, hair, visor);

    // --- Arms (capsules, pivot at shoulder) ---
    const armPivotL = new THREE.Group();
    armPivotL.position.set(0.33, 1.62, 0);
    const upperArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.32, 6, 10), shirtMat);
    upperArmL.position.y = -0.21;
    const foreArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.32, 6, 10), this.skinMat);
    foreArmL.position.y = -0.6;
    armPivotL.add(upperArmL, foreArmL);
    group.add(armPivotL);

    const armPivotR = new THREE.Group();
    armPivotR.position.set(-0.33, 1.62, 0);
    const upperArmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.32, 6, 10), shirtMat);
    upperArmR.position.y = -0.21;
    const foreArmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.32, 6, 10), this.skinMat);
    foreArmR.position.y = -0.6;
    armPivotR.add(upperArmR, foreArmR);
    group.add(armPivotR);

    // --- Legs (capsules, pivot at hip) ---
    const legPivotL = new THREE.Group();
    legPivotL.position.set(0.14, 0.86, 0);
    const thighL = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.40, 6, 10), pantsMat);
    thighL.position.y = -0.21;
    const shinL = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 6, 10), pantsMat);
    shinL.position.y = -0.62;
    const footL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.24), this.shoeMat);
    footL.position.set(0, -0.84, 0.04);
    legPivotL.add(thighL, shinL, footL);
    group.add(legPivotL);

    const legPivotR = new THREE.Group();
    legPivotR.position.set(-0.14, 0.86, 0);
    const thighR = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.40, 6, 10), pantsMat);
    thighR.position.y = -0.21;
    const shinR = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 6, 10), pantsMat);
    shinR.position.y = -0.62;
    const footR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.24), this.shoeMat);
    footR.position.set(0, -0.84, 0.04);
    legPivotR.add(thighR, shinR, footR);
    group.add(legPivotR);

    // No visible weapon — civilians blend in. (They still "fire" but it's
    // revealed by the spotlight, not by a visible gun.)

    parts.armL = armPivotL;
    parts.armR = armPivotR;
    parts.legL = legPivotL;
    parts.legR = legPivotR;
    parts.visor = visor;
    parts.head = head;

    // Contact shadow disk: grounds the model into the pavement (fake AO).
    const shadowGeo = new THREE.RingGeometry(0, 0.45, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    group.add(shadow);
    parts.shadow = shadow;

    // Reveal ring: a glowing halo shown when the bot is spotlight-revealed.
    const ringGeo = new THREE.RingGeometry(0.55, 0.75, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: CONFIG.spotlight.revealColor,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false, // visible through walls
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.visible = false;
    group.add(ring);
    parts.revealRing = ring;

    // Day-time infected tell: a faint corrupted aura ring that's visible in
    // daylight (unlike the visor which only glows at night). Subtle enough to
    // reward observation, but gives infected a readable "off" look in the day.
    const auraGeo = new THREE.RingGeometry(0.5, 0.62, 24);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xff2d78,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.04;
    aura.visible = false;
    group.add(aura);
    parts.auraRing = aura;

    return { group, parts };
  }

  spawnAll() {
    for (let i = 0; i < CONFIG.botCount; i++) {
      this.spawnBot();
    }
  }

  // Continuously spawn new civilians walking in from the edges, up to a cap.
  // Starts slow (every 30s) and accelerates over time.
  spawnCivilians(dt) {
    // Render-only clients don't spawn — the host owns the population.
    if (this.renderOnly) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    // Accelerate: shave time off the interval each spawn, down to a floor.
    this.spawnInterval = Math.max(
      CONFIG.bot.spawnIntervalMin,
      (this.spawnInterval || CONFIG.bot.spawnIntervalStart) - CONFIG.bot.spawnAccel
    );
    this.spawnTimer = this.spawnInterval;
    // Don't exceed the cap.
    if (this.bots.filter((b) => b.alive).length >= CONFIG.bot.maxCivilians) return;
    this.spawnBot();
  }

  // Remove all bots from the scene.
  clearAll() {
    for (const bot of this.bots) {
      if (bot.group.parent) this.scene.remove(bot.group);
    }
    this.bots = [];
    this.scene.userData.bots = this.bots;
  }

  // Count alive bots.
  aliveCount() {
    return this.bots.filter((b) => b.alive).length;
  }

  // Count infected bots.
  infectedCount() {
    return this.bots.filter((b) => b.alive && b.infected).length;
  }

  // Compute a 0..1 threat level for the dynamic music engine, based on the
  // distance to the nearest pursuing (chasing) infected bot.
  threatLevel(player) {
    if (!player) return 0;
    let nearest = Infinity;
    for (const bot of this.bots) {
      if (!bot.alive || !bot.infected) continue;
      if (bot.state !== 'chase') continue;
      const d = bot.pos.distanceTo(player.pos);
      if (d < nearest) nearest = d;
    }
    if (nearest === Infinity) return 0;
    // Full panic within ~8m, fading to calm by ~40m.
    const t = 1 - Math.max(0, Math.min(1, (nearest - 8) / 32));
    return t;
  }

  // Set up the infection: mark the initial infected bots.
  setupInfection(player) {
    const alive = this.bots.filter((b) => b.alive);
    const count = Math.min(CONFIG.infection.initialInfected, alive.length);
    for (let i = 0; i < count; i++) {
      // Prefer a bot near the player so the threat is immediately felt.
      let bot;
      if (player && alive.length > 1) {
        const sorted = [...alive].sort((a, b) =>
          a.pos.distanceTo(player.pos) - b.pos.distanceTo(player.pos)
        );
        bot = sorted[Math.floor(Math.random() * Math.min(3, sorted.length))];
      } else {
        bot = alive[Math.floor(Math.random() * alive.length)];
      }
      this.infectBot(bot);
    }
  }

  // Infect a bot (make it "the other").
  infectBot(bot) {
    if (!bot || !bot.alive || bot.infected) return;
    bot.infected = true;
    bot.infectCooldown = 0;
    // Assign an infected role. Patient Zero (first) is the Stalker; the rest
    // become Flankers or Rushers.
    const infectedCount = this.bots.filter((b) => b.alive && b.infected).length;
    if (infectedCount === 0) {
      bot.role = INFECTED_ROLES.STALKER;
    } else {
      bot.role = Math.random() > 0.4 ? INFECTED_ROLES.FLANKER : INFECTED_ROLES.RUSHER;
    }
    // Infected bots reveal a subtle corrupted visor glow — but ONLY at night.
    // During the day the visor stays dark so infected blend in with civilians.
    if (bot.parts && bot.parts.visor) {
      const night = this.world.isNight ? this.world.isNight() : true;
      bot.parts.visor.visible = night;
      bot.parts.visor.material.color.setHex(0x00ff88);
      bot.parts.visor.material.emissive.setHex(0x00ff88);
    }
    // Visual tell on conversion.
    if (this.effects && this.effects.infectionTaint) {
      this.effects.infectionTaint(bot.pos);
    }
  }

  // Update infection spread: infected bots infect nearby uninfected bots.
  updateInfection(dt) {
    // Render-only clients don't simulate infection — the host owns it.
    if (this.renderOnly) return;
    const infected = this.bots.filter((b) => b.alive && b.infected);
    const infectedCount = infected.length;
    // Aggression preset scales cooldown & range.
    const preset = CONFIG.infection.aggressionPresets[CONFIG.infection.aggression] || CONFIG.infection.aggressionPresets.meh;
    // Global rate cap: accumulate a budget of allowed new infections per second.
    // This is the real brake on the snowball — with 20 infected each trying to
    // infect every 0.5s, the budget still only allows ~1 per 3s on aggressive.
    const rate = CONFIG.infection.maxInfectionsPerSec[CONFIG.infection.aggression] || 0.15;
    this.infectionBudget = Math.min(1.5, this.infectionBudget + rate * dt);

    const cooldown = Math.max(
      0.4,
      CONFIG.infection.infectCooldown * preset.cooldownMult - infectedCount * CONFIG.infection.spreadBoost
    );
    const range = CONFIG.infection.infectRange * preset.rangeMult;
    for (const bot of infected) {
      bot.infectCooldown -= dt;
      if (bot.infectCooldown <= 0 && this.infectionBudget >= 1) {
        // Find a nearby uninfected bot (within the preset's range).
        for (const other of this.bots) {
          if (other === bot || !other.alive || other.infected) continue;
          if (bot.pos.distanceTo(other.pos) < range) {
            this.infectBot(other);
            bot.infectCooldown = cooldown;
            this.infectionBudget -= 1;
            break;
          }
        }
      }
    }
  }

  // Spawn an initial population of civilians so the infected isn't easy to find.
  spawnInitial(count) {
    const cap = CONFIG.bot.maxCivilians;
    const n = Math.max(1, Math.min(count, cap));
    for (let i = 0; i < n; i++) {
      this.spawnBot();
    }
  }

  spawnBot() {
    const bot = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      health: CONFIG.bot.health,
      alive: true,
      state: 'patrol',
      target: new THREE.Vector3(),
      fireCooldown: Math.random() * 2,
      respawnTimer: 0,
      group: new THREE.Group(),
      bobPhase: Math.random() * Math.PI * 2,
      walkPhase: 0,
      recoil: 0,
      // Archetype & role
      archetype: this._pickArchetype(),
      role: null,
      // Smarter AI state
      burstCount: 0,          // shots fired in current burst
      burstPauseTimer: 0,     // time between bursts
      coverPoint: null,       // current cover position
      coverTimer: 0,          // time to stay in cover
      flankDir: Math.random() < 0.5 ? 1 : -1,
      lastDamageTime: -999,
      reactionTimer: 0,
      // Stuck detection for natural patrol movement
      stuckTimer: 0,
      lastPos: new THREE.Vector3(),
      // Archetype behavior timers
      pauseTimer: 0,
      mimicTimer: 0,
      // Infection state
      infected: false,
      infectCooldown: 0,
      // Idle wander target (prevents infected clustering when idle)
      wanderTarget: null,
      // Spotlight reveal state (seconds remaining of being revealed)
      revealed: 0,
      // Player-tagged suspect (shown on minimap)
      tagged: false,
      // random skin/visor tint variation
      visorColor: new THREE.Color().setHSL(0.95 + Math.random() * 0.1, 0.9, 0.55),
    };

    // Find a spawn position
    let x, z;
    let attempts = 0;
    do {
      x = (Math.random() * 2 - 1) * (CONFIG.worldSize - 20);
      z = (Math.random() * 2 - 1) * (CONFIG.worldSize - 20);
      attempts++;
    } while (this.world.collides(x, z, 0.5) && attempts < 50);
    bot.pos.set(x, 0, z);

    // Build humanoid
    const { group, parts } = this._buildHumanoid();
    bot.group = group;
    bot.parts = parts;
    parts.visor.material = this.visorMat.clone();
    parts.visor.material.color.copy(bot.visorColor);
    parts.visor.material.emissive.copy(bot.visorColor);
    group.position.copy(bot.pos);
    this.scene.add(group);

    this.bots.push(bot);
    return bot;
  }

  damage(bot, amount, source) {
    if (!bot.alive) return;
    bot.health -= amount;
    bot.lastDamageTime = performance.now() / 1000;
    bot.reactionTimer = CONFIG.bot.reactionTime;
    // Only infected bots become hostile when shot; civilians stay passive.
    if (bot.infected) bot.state = 'chase';
    if (bot.health <= 0) {
      this.kill(bot, source);
    }
  }

  kill(bot, source) {
    bot.alive = false;
    bot.respawnTimer = CONFIG.bot.respawnTime;
    this.effects.explosion(bot.pos.clone().add(new THREE.Vector3(0, 1, 0)), 'blood', 24, 6);
    this.audio.kill();
    this.scene.remove(bot.group);
    // Drop a useful item
    if (this.onDrop && Math.random() < CONFIG.bot.dropChance) {
      const type = Math.random() < 0.5 ? 'health' : 'ammo';
      this.onDrop(bot.pos, type);
    }
    // Killing an innocent civilian (non-infected) by the player = game over.
    // suppressCivilianKill lets the host resolve a CLIENT's shot without
    // penalizing the host — the client gets its own gameover message instead.
    if (source === this.playerRef && !bot.infected && this.onCivilianKilled && !this.suppressCivilianKill) {
      this.onCivilianKilled();
    }
    // suppressKillCredit: the host resolves a CLIENT's shot — don't credit the
    // host's score/kills for a kill the client made.
    if (this.onKill && !this.suppressKillCredit) this.onKill(source, bot.infected);
  }

  // Alert nearby bots to a gunshot at a position.
  alert(position) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const dist = bot.pos.distanceTo(position);
      // Infected bots are drawn to gunfire from anywhere — shooting reveals you.
      if (bot.infected) {
        bot.lastKnownPlayerPos = position.clone();
        bot.state = 'chase';
        bot.lastDamageTime = performance.now() / 1000;
        continue;
      }
      if (dist < CONFIG.bot.alertRadius) {
        bot.state = 'chase';
        bot.lastDamageTime = performance.now() / 1000;
      }
    }
  }

  // Alert bots to footstep noise within a radius (stealth-aware).
  alertNoise(position, radius) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const dist = bot.pos.distanceTo(position);
      if (dist < radius) {
        bot.lastKnownPlayerPos = position.clone();
        bot.state = 'chase';
        bot.lastDamageTime = performance.now() / 1000;
      }
    }
  }

  update(dt, player, hiding, rival = null) {
    const now = performance.now() / 1000;
    // Continuously spawn new civilians walking in.
    this.spawnCivilians(dt);
    for (const bot of this.bots) {
      if (!bot.alive) {
        // Render-only clients keep dead bots hidden until the host revives them.
        if (this.renderOnly) {
          if (bot.group.parent) this.scene.remove(bot.group);
          continue;
        }
        bot.respawnTimer -= dt;
        if (bot.respawnTimer <= 0) {
          // respawn
          bot.health = CONFIG.bot.health;
          bot.alive = true;
          bot.state = 'patrol';
          bot.coverPoint = null;
          bot.burstCount = 0;
          bot.burstPauseTimer = 0;
          let x, z, attempts = 0;
          do {
            x = (Math.random() * 2 - 1) * (CONFIG.worldSize - 20);
            z = (Math.random() * 2 - 1) * (CONFIG.worldSize - 20);
            attempts++;
          } while (this.world.collides(x, z, 0.5) && attempts < 50);
          bot.pos.set(x, 0, z);
          bot.group.position.copy(bot.pos);
          this.scene.add(bot.group);
        }
        continue;
      }

      const toPlayer = player.pos.clone().sub(bot.pos);
      toPlayer.y = 0;
      const distToPlayer = toPlayer.length();
      const hasLOS = this.world.hasLineOfSight(bot.pos, player.pos);

      // Render-only clients: skip ALL AI — the host broadcasts authoritative
      // transforms every 30Hz. Just animate the limbs for a living look.
      if (this.renderOnly) {
        if (!bot.alive) continue; // dead bots are hidden by _applyHostState
        bot.walkPhase += dt * 9;
        const swing = Math.sin(bot.walkPhase) * 0.6;
        const swing2 = Math.sin(bot.walkPhase + Math.PI) * 0.6;
        bot.parts.legL.rotation.x = swing;
        bot.parts.legR.rotation.x = swing2;
        bot.parts.armL.rotation.x = -swing2 * 0.7;
        bot.parts.armR.rotation.x = -swing * 0.7;
        bot.group.position.y = Math.abs(Math.sin(performance.now() / 300 + bot.bobPhase)) * 0.05;
        if (bot.parts.shadow) bot.parts.shadow.position.y = -bot.group.position.y + 0.01;
        // Infected visual tells come from host snapshots (visor at night, aura by day).
        if (bot.infected && bot.parts) {
          const night = this.world.isNight ? this.world.isNight() : true;
          if (bot.parts.visor) bot.parts.visor.visible = night;
          if (bot.parts.auraRing) {
            bot.parts.auraRing.visible = !night;
            bot.parts.auraRing.material.opacity = 0.12 + Math.sin(performance.now() / 900 + bot.bobPhase * 4) * 0.05;
          }
        }
        continue;
      }

      // Decay the spotlight reveal timer
      if (bot.revealed > 0) bot.revealed -= dt;
      // Show/hide the reveal ring (visible through walls)
      if (bot.parts.revealRing) {
        bot.parts.revealRing.visible = bot.revealed > 0;
        if (bot.revealed > 0) {
          bot.parts.revealRing.rotation.z += dt * 3;
        }
      }
      // Infected visor glows only at night — day/night transition handled live.
      // During the day, a faint corrupted aura ring is the tell instead.
      if (bot.infected && bot.parts) {
        const night = this.world.isNight ? this.world.isNight() : true;
        if (bot.parts.visor) bot.parts.visor.visible = night;
        if (bot.parts.auraRing) {
          bot.parts.auraRing.visible = !night;
          // Pulse subtly so it reads as "alive" but not a beacon.
          bot.parts.auraRing.material.opacity = 0.12 + Math.sin(performance.now() / 900 + bot.bobPhase * 4) * 0.05;
        }
      }

      // During hide phase, bots only patrol (don't attack)
      if (hiding) {
        bot.state = 'patrol';
        bot.coverPoint = null;
      }

      // --- State machine ---
      // Only infected bots are hostile. Uninfected civilians just patrol.
      if (bot.infected && distToPlayer < CONFIG.bot.aggroRange && hasLOS && !hiding) {
        bot.state = 'chase';
      } else if (bot.state === 'chase' && distToPlayer > CONFIG.bot.aggroRange * 1.5) {
        bot.state = 'patrol';
        bot.coverPoint = null;
        bot.target.set(
          bot.pos.x + (Math.random() * 2 - 1) * CONFIG.bot.patrolRadius,
          0,
          bot.pos.z + (Math.random() * 2 - 1) * CONFIG.bot.patrolRadius
        );
      } else if (!bot.infected) {
        // Civilians never chase or attack — always patrol.
        bot.state = 'patrol';
        bot.coverPoint = null;
      }

      // --- Decision making ---
      let moveDir = new THREE.Vector3();
      let moving = false;
      let shouldFire = false;

      // --- Infected behavior: role-based hunting, infecting NPCs along the way ---
      if (bot.infected) {
        const inf = CONFIG.infection;
        const preset = inf.aggressionPresets[inf.aggression] || inf.aggressionPresets.meh;
        const role = bot.role || INFECTED_ROLES.RUSHER;
        // Pick the nearest alive target: the host player, or the rival (PVP).
        let target = player;
        if (rival && rival.alive) {
          const dPlayer = bot.pos.distanceTo(player.pos);
          const dRival = bot.pos.distanceTo(rival.pos);
          if (dRival < dPlayer) target = rival;
        }
        const toTarget = new THREE.Vector3(target.pos.x - bot.pos.x, 0, target.pos.z - bot.pos.z);
        const distToTarget = toTarget.length();

        // Infect any uninfected NPC we pass close to (range scales with aggression).
        // Gated by the same infectCooldown AND the global infection budget so
        // a single infected can't chain-infect the whole crowd in one frame.
        const passRange = inf.infectRange * preset.rangeMult;
        if (bot.infectCooldown <= 0 && this.infectionBudget >= 1) {
          for (const other of this.bots) {
            if (other === bot || !other.alive || other.infected) continue;
            if (bot.pos.distanceTo(other.pos) < passRange) {
              this.infectBot(other);
              bot.infectCooldown = Math.max(
                0.4,
                CONFIG.infection.infectCooldown * preset.cooldownMult
              );
              this.infectionBudget -= 1;
              break;
            }
          }
        }

        // Determine movement target & speed based on role.
        let moveTarget = target.pos;
        let speedMult = inf.infectedSpeed;
        let seeking = false;

        // Aggressive/insane infected prioritize seeking out nearby uninfected NPCs
        // to spread the infection, rather than always chasing the player.
        // The seek range is the FULL map for aggressive+ — the infected should
        // actively hunt down civilians, not just the ones within a tiny radius.
        if (preset.seekRange > 0) {
          let nearestCiv = null;
          let nearestDist = preset.seekRange;
          for (const other of this.bots) {
            if (other === bot || !other.alive || other.infected) continue;
            const d = bot.pos.distanceTo(other.pos);
            if (d < nearestDist) {
              nearestDist = d;
              nearestCiv = other;
            }
          }
          if (nearestCiv) {
            moveTarget = nearestCiv.pos;
            speedMult = inf.infectedSpeed * preset.seekSpeed; // move fast to reach & infect
            seeking = true;
          }
        }

        if (!seeking) {
          if (role === INFECTED_ROLES.STALKER) {
            // Patient Zero: blends in, stalks from a distance, only closes when cornered.
            speedMult = 1.0;
            if (distToTarget > 12) {
              moveTarget = target.pos;
            } else if (distToTarget < 3) {
              moveTarget = target.pos; // cornered — attack
            } else {
              // Lingers at distance, pathing to adjacent cover points.
              // Add a per-bot jitter so multiple stalkers don't pick the same
              // cover point and cluster together.
              const cover = this._findCover(bot, player);
              if (cover) {
                const jitter = bot.bobPhase || 0;
                moveTarget = cover.clone().add(new THREE.Vector3(
                  Math.sin(jitter * 3) * 2,
                  0,
                  Math.cos(jitter * 2) * 2
                ));
              } else {
                moveTarget = target.pos;
              }
            }
          } else if (role === INFECTED_ROLES.FLANKER) {
            // Cuts off escapes via doors/alleys rather than direct LOS.
            speedMult = inf.infectedSpeed * 0.9;
            const waypoint = this.world.findPathTo(bot.pos, target.pos);
            if (waypoint) moveTarget = waypoint;
          } else {
            // RUSHER: aggressive direct pursuer.
            speedMult = inf.infectedSpeed * 1.15;
            moveTarget = target.pos;
          }
        }

        // If the player fired recently, home toward the last known shot location.
        // BUT only if we're not actively seeking a civilian to infect — spreading
        // the infection is the priority for aggressive/insane presets.
        if (bot.lastKnownPlayerPos && !seeking) {
          moveTarget = bot.lastKnownPlayerPos;
        }

        // Use door pathfinding if the direct path is blocked by a building.
        if (!this.world.hasLineOfSight(bot.pos, moveTarget)) {
          const waypoint = this.world.findPathTo(bot.pos, moveTarget);
          if (waypoint) moveTarget = waypoint;
        }
        const toMove = new THREE.Vector3(moveTarget.x - bot.pos.x, 0, moveTarget.z - bot.pos.z);
        if (toMove.length() > 0.5) {
          moveDir.copy(toMove).normalize();
          moving = true;
          bot.group.rotation.y = Math.atan2(moveDir.x, moveDir.z);
        } else if (!seeking && distToTarget > CONFIG.bot.aggroRange) {
          // Idle wander: player is far away and no civilian to seek — pick a
          // random patrol point instead of standing still (prevents clustering).
          if (!bot.wanderTarget || bot.pos.distanceTo(bot.wanderTarget) < 2) {
            bot.wanderTarget = new THREE.Vector3(
              bot.pos.x + (Math.random() * 2 - 1) * 14,
              0,
              bot.pos.z + (Math.random() * 2 - 1) * 14
            );
            // Keep wander targets inside the world.
            bot.wanderTarget.x = Math.max(-WORLD_HALF + 3, Math.min(WORLD_HALF - 3, bot.wanderTarget.x));
            bot.wanderTarget.z = Math.max(-WORLD_HALF + 3, Math.min(WORLD_HALF - 3, bot.wanderTarget.z));
          }
          const toWander = new THREE.Vector3(bot.wanderTarget.x - bot.pos.x, 0, bot.wanderTarget.z - bot.pos.z);
          if (toWander.length() > 0.5) {
            moveDir.copy(toWander).normalize();
            moving = true;
            bot.group.rotation.y = Math.atan2(moveDir.x, moveDir.z);
          }
        }

        // Separation: infected push apart from each other so they don't
        // congregate into a single clump. Each infected repels nearby infected.
        for (const other of this.bots) {
          if (other === bot || !other.alive || !other.infected) continue;
          const dx = bot.pos.x - other.pos.x;
          const dz = bot.pos.z - other.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 0.01 && d2 < 2.25) { // within 1.5m
            const d = Math.sqrt(d2);
            const push = (1.5 - d) / 1.5; // 0 at edge, 1 at center
            moveDir.x += (dx / d) * push * 1.2;
            moveDir.z += (dz / d) * push * 1.2;
            if (moveDir.lengthSq() > 0.01) {
              moveDir.normalize();
              moving = true;
            }
          }
        }

        // Damage the target on contact (host player or PVP rival).
        if (distToTarget < inf.infectRange && target.alive) {
          target.damage(inf.infectedDamage);
          if (target === player && this.onPlayerDamage) this.onPlayerDamage();
          // If the rival was killed, notify the client (PVP).
          if (target !== player && !target.alive && this.onRivalKilled) {
            this.onRivalKilled();
          }
        }

        // Infected move at role-based speed.
        const speed = CONFIG.bot.speed * speedMult;
        bot.pos.addScaledVector(moveDir, speed * dt);
        this.world.resolveCollision(bot.pos, 0.5);
        bot.group.position.copy(bot.pos);

        // --- Animation ---
        bot.walkPhase += dt * (moving ? 11 : 2);
        const swing = Math.sin(bot.walkPhase) * (moving ? 0.7 : 0.05);
        const swing2 = Math.sin(bot.walkPhase + Math.PI) * (moving ? 0.7 : 0.05);
        bot.parts.legL.rotation.x = swing;
        bot.parts.legR.rotation.x = swing2;
        bot.parts.armL.rotation.x = -swing2 * 0.8;
        bot.parts.armR.rotation.x = -swing * 0.8;
        bot.group.position.y = Math.abs(Math.sin(performance.now() / 300 + bot.bobPhase)) * 0.05;
        // Contact shadow stays glued to the ground while the body bobs.
        if (bot.parts.shadow) bot.parts.shadow.position.y = -bot.group.position.y + 0.01;

        // Head-snap tell: infected glance toward the player even while walking.
        if (bot.parts.head && distToTarget < 14) {
          const lookDir = Math.atan2(toTarget.x, toTarget.z);
          bot.parts.head.rotation.y = (lookDir - bot.group.rotation.y) * 0.7;
        } else if (bot.parts.head) {
          bot.parts.head.rotation.y = 0;
        }
        continue;
      }

      if (bot.state === 'chase') {
        // Retreat if low health
        const retreating = bot.health < CONFIG.bot.retreatHealth;

        // Seek cover if: under fire, or at long range, or low health
        const wantCover = retreating || (now - bot.lastDamageTime < 3 && bot.coverTimer <= 0);

        if (wantCover && !bot.coverPoint) {
          bot.coverPoint = this._findCover(bot, player);
          bot.coverTimer = 1.5 + Math.random() * 1.5;
        }

        if (bot.coverPoint && bot.coverTimer > 0) {
          // Move to / stay in cover
          bot.coverTimer -= dt;
          const toCover = bot.coverPoint.clone().sub(bot.pos);
          toCover.y = 0;
          if (toCover.length() > 1.5) {
            toCover.normalize();
            bot.pos.addScaledVector(toCover, CONFIG.bot.speed * dt);
            moving = true;
          } else {
            // In cover — peek out and fire occasionally
            if (hasLOS && distToPlayer < CONFIG.bot.fireRange) {
              shouldFire = true;
            }
          }
          // Face player while in cover
          bot.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        } else {
          bot.coverPoint = null;
          // Path through doors if the direct path to the player is blocked
          let moveTarget = player.pos;
          if (!hasLOS) {
            const waypoint = this.world.findPathTo(bot.pos, player.pos);
            if (waypoint) moveTarget = waypoint;
          }
          const toTarget = new THREE.Vector3(moveTarget.x - bot.pos.x, 0, moveTarget.z - bot.pos.z);
          const distToTarget = toTarget.length();

          // Flank: strafe around the player
          const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).normalize();
          const flankSpeed = CONFIG.bot.speed * CONFIG.bot.flankSpeed;
          bot.pos.addScaledVector(strafe, bot.flankDir * flankSpeed * dt);
          moving = true;

          // Close distance if too far
          if (distToTarget > CONFIG.bot.fireRange * 0.8) {
            bot.pos.addScaledVector(toTarget.normalize(), CONFIG.bot.speed * dt);
          }

          // Face player
          bot.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

          // Fire if in range and has LOS
          if (distToPlayer < CONFIG.bot.fireRange && hasLOS) {
            shouldFire = true;
          }
        }
      } else {
        // --- Civilian archetype behaviors ---
        const arch = bot.archetype;

        // Mimic: echo the player's crouch/sprint briefly.
        if (arch === BOT_ARCHETYPES.MIMIC && distToPlayer < 8 && hasLOS) {
          if (player.crouching) {
            bot.mimicTimer = 3.0;
            bot.group.scale.set(1.0, 0.65, 1.0);
          } else if (bot.mimicTimer > 0) {
            bot.mimicTimer -= dt;
            bot.group.scale.set(1.0, 0.65, 1.0);
          } else {
            bot.group.scale.set(1.0, 1.0, 1.0);
          }
        } else if (bot.mimicTimer > 0) {
          bot.mimicTimer -= dt;
          bot.group.scale.set(1.0, 0.65, 1.0);
        } else {
          bot.group.scale.set(1.0, 1.0, 1.0);
        }

        // Nervous: freeze and stare if the player makes loud noise nearby.
        if (arch === BOT_ARCHETYPES.NERVOUS && player.noiseRadius > 8 && distToPlayer < player.noiseRadius) {
          bot.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
          moving = false;
        } else if (arch === BOT_ARCHETYPES.LOITERER) {
          // Loiterer: pauses outside doors and corners.
          if (bot.pauseTimer > 0) {
            bot.pauseTimer -= dt;
            moving = false;
          } else if (Math.random() < 0.005) {
            bot.pauseTimer = 3.0 + Math.random() * 4.0;
            moving = false;
          } else {
            this._patrolMove(bot, dt);
            moving = true;
          }
        } else {
          // Commuter / default: standard patrol.
          this._patrolMove(bot, dt);
          moving = true;
        }
      }

      // --- Burst fire logic ---
      if (shouldFire && player.alive) {
        bot.fireCooldown -= dt;
        if (bot.burstPauseTimer > 0) {
          bot.burstPauseTimer -= dt;
        } else if (bot.fireCooldown <= 0) {
          // Fire a shot
          bot.fireCooldown = CONFIG.bot.fireRate;
          this._botShoot(bot, player, distToPlayer);
          bot.recoil = 1;
          bot.burstCount++;
          // Reveal this bot: the spotlight locks onto it briefly.
          bot.revealed = CONFIG.spotlight.revealDuration;
          if (this.world.revealBot) this.world.revealBot(bot);
          // End burst after burstSize shots
          if (bot.burstCount >= CONFIG.bot.burstSize) {
            bot.burstCount = 0;
            bot.burstPauseTimer = CONFIG.bot.burstPause;
          }
        }
      } else {
        bot.fireCooldown = Math.min(bot.fireCooldown, 0.2);
        bot.burstCount = 0;
      }

      // Collision resolve
      this.world.resolveCollision(bot.pos, 0.5);
      bot.group.position.copy(bot.pos);

      // --- Animation ---
      if (moving) {
        bot.walkPhase += dt * 9;
      } else {
        bot.walkPhase += dt * 2; // idle sway
      }
      const swing = Math.sin(bot.walkPhase) * (moving ? 0.6 : 0.05);
      const swing2 = Math.sin(bot.walkPhase + Math.PI) * (moving ? 0.6 : 0.05);
      bot.parts.legL.rotation.x = swing;
      bot.parts.legR.rotation.x = swing2;
      bot.parts.armL.rotation.x = -swing2 * 0.7;
      bot.parts.armR.rotation.x = -swing * 0.7;

      // Aim arms forward when chasing
      const aim = bot.state === 'chase' ? 1 : 0;
      bot.parts.armL.rotation.x += -1.2 * aim;
      bot.parts.armR.rotation.x += -1.2 * aim;

      // Bob
      bot.group.position.y = Math.abs(Math.sin(performance.now() / 300 + bot.bobPhase)) * 0.05;
      // Contact shadow stays glued to the ground while the body bobs.
      if (bot.parts.shadow) bot.parts.shadow.position.y = -bot.group.position.y + 0.01;
    }
  }

  // Pick a new walkable patrol target near the bot (not inside a wall).
  _pickPatrolTarget(bot) {
    let x, z, attempts = 0;
    do {
      x = bot.pos.x + (Math.random() * 2 - 1) * CONFIG.bot.patrolRadius;
      z = bot.pos.z + (Math.random() * 2 - 1) * CONFIG.bot.patrolRadius;
      attempts++;
    } while (this.world.collides(x, z, 0.5) && attempts < 20);
    bot.target.set(x, 0, z);
  }

  // Standard patrol movement toward the bot's target, with stuck detection.
  _patrolMove(bot, dt) {
    const toTarget = bot.target.clone().sub(bot.pos);
    toTarget.y = 0;
    const distToTarget = toTarget.length();
    if (distToTarget < 2) {
      // Reached target — pick a new walkable spot nearby.
      this._pickPatrolTarget(bot);
    } else {
      toTarget.normalize();
      bot.pos.addScaledVector(toTarget, CONFIG.bot.speed * 0.5 * dt);
      bot.group.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    }
    // Stuck detection: if we barely moved, pick a new target.
    bot.stuckTimer += dt;
    if (bot.stuckTimer > 1.5) {
      const moved = bot.pos.distanceTo(bot.lastPos);
      if (moved < 0.3) {
        this._pickPatrolTarget(bot);
      }
      bot.stuckTimer = 0;
      bot.lastPos.copy(bot.pos);
    }
  }

  // Pick a civilian archetype with weighted probabilities.
  _pickArchetype() {
    const r = Math.random();
    if (r < 0.5) return BOT_ARCHETYPES.COMMUTER;
    if (r < 0.75) return BOT_ARCHETYPES.LOITERER;
    if (r < 0.9) return BOT_ARCHETYPES.NERVOUS;
    return BOT_ARCHETYPES.MIMIC;
  }

  // Find a nearby cover point that's between the bot and the player.
  _findCover(bot, player) {
    const coverPoints = this.world.getCoverPoints();
    let best = null;
    let bestScore = Infinity;
    for (const point of coverPoints) {
      // Skip if the point collides
      if (this.world.collides(point.x, point.z, 0.5)) continue;
      const distToBot = point.distanceTo(bot.pos);
      if (distToBot > CONFIG.bot.coverRange) continue;
      // Prefer cover that's close to the bot and roughly between bot and player
      const toPlayer = player.pos.clone().sub(bot.pos);
      const toCover = point.clone().sub(bot.pos);
      const alignment = toPlayer.normalize().dot(toCover.normalize());
      const score = distToBot * (1.5 - alignment);
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best;
  }

  _botShoot(bot, player, dist) {
    // Belt-and-suspenders: never deal damage through a wall or roof.
    if (!this.world.hasLineOfSight(bot.pos, player.pos)) return;
    // Accuracy: chance to hit based on distance
    const hitChance = CONFIG.bot.accuracy * (1 - dist / CONFIG.bot.fireRange);
    if (Math.random() < hitChance) {
      player.damage(CONFIG.bot.damage);
      if (this.onPlayerDamage) this.onPlayerDamage();
      this.audio.hurt();
      this.effects.impact(player.pos.clone(), new THREE.Vector3(0, 1, 0));
    }
    // Tracer from bot to player
    const start = bot.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const end = player.pos.clone().add(new THREE.Vector3(0, 1, 0));
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0xff2d78, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    setTimeout(() => {
      this.scene.remove(line);
      geo.dispose();
      mat.dispose();
    }, 80);
  }

  dispose() {
    this.bodyMat.dispose();
    this.darkMat.dispose();
    this.accentMat.dispose();
    this.visorMat.dispose();
    this.gunMat.dispose();
    this.gunAccentMat.dispose();
  }
}
