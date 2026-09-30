// Central tuning constants for the whole game.

export const CONFIG = {
  // World
  worldSize: 55,           // half-extent of the playable city area (tight, dense)
  buildingCount: 18,
  buildingMinH: 8,
  buildingMaxH: 16,
  streetWidth: 8,
  crateCount: 30,
  barrierCount: 16,
  botCount: 100,
  pickupCount: 4,

  // Building interior
  building: {
    wallThick: 0.5,
    doorWidth: 2.2,
    doorHeight: 2.6,
    stepHeight: 0.5,       // max height player can auto-step up
    stairStepH: 0.5,       // stair step height
    stairStepD: 0.4,       // stair step depth
    windowCount: 3,        // windows per wall
  },

  // Player
  player: {
    height: 1.7,
    radius: 0.4,
    speed: 6.0,
    sprintMult: 1.6,
    jumpVel: 7.5,
    gravity: 22,
    maxHealth: 100,
    regenDelay: 4.0,       // seconds after damage before regen
    regenRate: 12,         // hp per second
  },

  // Hide countdown phase
  hidePhase: {
    duration: 15,          // seconds to hide before the deathmatch starts
    botsPatrol: true,      // bots patrol (don't attack) during hide phase
  },

  // Weapons (multiple, switchable with 1-4 or scroll wheel)
  weapons: {
    rifle: {
      name: 'RIFLE',
      damage: 34,
      fireRate: 0.11,        // seconds between shots
      magSize: 30,
      reserve: 90,
      reloadTime: 1.6,
      spread: 0.012,         // radians
      recoil: 0.02,
      range: 300,
      auto: true,
      pellets: 1,
      tracerColor: 0xffd166,
    },
    smg: {
      name: 'SMG',
      damage: 16,
      fireRate: 0.06,
      magSize: 40,
      reserve: 120,
      reloadTime: 1.8,
      spread: 0.035,
      recoil: 0.015,
      range: 200,
      auto: true,
      pellets: 1,
      tracerColor: 0xffaa33,
    },
    shotgun: {
      name: 'SHOTGUN',
      damage: 12,
      fireRate: 0.8,
      magSize: 8,
      reserve: 32,
      reloadTime: 2.2,
      spread: 0.09,
      recoil: 0.06,
      range: 60,
      auto: false,
      pellets: 8,
      tracerColor: 0xff8844,
    },
    sniper: {
      name: 'SNIPER',
      damage: 120,
      fireRate: 1.4,
      magSize: 5,
      reserve: 20,
      reloadTime: 2.5,
      spread: 0.001,
      recoil: 0.08,
      range: 500,
      auto: false,
      pellets: 1,
      tracerColor: 0x00e5ff,
    },
    // Melee weapons (picked up, not starting weapons)
    knife: {
      name: 'KNIFE',
      damage: 50,
      fireRate: 0.4,
      magSize: Infinity,
      reserve: Infinity,
      reloadTime: 0,
      spread: 0,
      recoil: 0.03,
      range: 2.2,
      auto: false,
      pellets: 1,
      melee: true,
      meleeType: 'stab',
      tracerColor: 0xffffff,
    },
    machete: {
      name: 'MACHETE',
      damage: 70,
      fireRate: 0.55,
      magSize: Infinity,
      reserve: Infinity,
      reloadTime: 0,
      spread: 0,
      recoil: 0.05,
      range: 2.6,
      auto: false,
      pellets: 1,
      melee: true,
      meleeType: 'slash',
      tracerColor: 0xffffff,
    },
  },

  // Bots
  bot: {
    health: 60,
    speed: 3.2,
    damage: 8,
    fireRate: 0.9,
    fireRange: 40,
    aggroRange: 55,
    accuracy: 0.55,
    respawnTime: 6,
    patrolRadius: 25,
    // Smarter AI
    burstSize: 4,          // shots per burst
    burstPause: 0.6,       // seconds between bursts
    coverRange: 30,        // how far to look for cover
    flankSpeed: 1.4,       // strafe speed multiplier when flanking
    retreatHealth: 25,     // retreat below this health
    reactionTime: 0.4,     // delay before reacting to being shot
    // Alert system
    alertRadius: 45,       // how far gunshots travel
    alertCooldown: 2.0,    // seconds between alerts
    // Drops
    dropChance: 0.25,      // chance to drop an item on death
    // Continuous spawning — new NPCs sneak in over time, accelerating.
    spawnIntervalStart: 30, // seconds between spawns at the start
    spawnIntervalMin: 3,    // fastest spawn interval (as the game speeds up)
    spawnAccel: 0.5,        // seconds shaved off the interval per spawn
    maxCivilians: 60,       // hard cap on total NPCs on the map (memory-safe)
    // Bot-vs-bot combat
    botDamage: 6,          // damage bots deal to each other
    botFireRange: 35,      // range bots engage each other
    botAggroRange: 50,     // range bots notice each other
  },

  // Infection mechanic (1v1 "other" mode)
  infection: {
    initialInfected: 1,    // how many start infected
    infectRange: 2.5,      // distance to infect another
    infectCooldown: 3.0,   // seconds between infections
    spreadBoost: 0.15,     // infection speed boost per infected NPC
    infectedSpeed: 2.0,    // speed multiplier for infected (faster than player)
    infectedDamage: 15,    // melee damage infected deal to player
  },

  // Pickups
  pickup: {
    healthAmount: 30,
    ammoAmount: 45,
    respawnTime: 15,
  },

  // Weapon pickups (guns and melee found on the map)
  weaponPickup: {
    rifleCount: 1,
    smgCount: 1,
    shotgunCount: 1,
    sniperCount: 1,
    macheteCount: 1,
  },

  // Stamina / sprint
  stamina: {
    max: 100,
    drainRate: 30,         // per second while sprinting
    regenRate: 18,         // per second when not sprinting
    regenDelay: 0.8,       // seconds after sprinting before regen
    sprintMult: 1.6,       // speed multiplier while sprinting
  },

  // Effects
  effects: {
    maxParticles: 600,
    shakeDecay: 2.2,
  },

  // Day-night
  dayNight: {
    cycleMinutes: 2.0,     // full day/night cycle length
    startHour: 9,          // starting hour of day (0-24)
  },

  // Spotlight reveal: when a bot fires, it's briefly revealed through walls.
  spotlight: {
    revealDuration: 4.0,   // seconds a firing bot stays revealed
    sweepSpeed: 0.6,       // radians per second for the sweeping spotlight
    revealColor: 0xff2d78, // color of the reveal glow
  },
};

export const WORLD_HALF = CONFIG.worldSize;
