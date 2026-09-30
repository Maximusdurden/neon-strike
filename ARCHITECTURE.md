# Neon Strike — Architecture & Rules of the Match

A procedural 3D first-person shooter built with **three.js** (v0.160.0, loaded via CDN import map). No build tools, no npm — pure ES modules served over a static HTTP server.

---

## 1. Project Layout

```
neon-strike/
├── index.html          # Entry point: import map, HUD, overlays, script tag
├── css/style.css       # All styling (HUD, scope, vignette, counters, etc.)
├── js/
│   ├── config.js       # Central tuning constants + WORLD_HALF export
│   ├── main.js         # Game class: state machine, update loop, wiring
│   ├── world.js        # Procedural city: buildings, stairs, crates, LOS
│   ├── player.js       # FPS controller: movement, camera, health, stamina
│   ├── weapons.js      # Multi-weapon system + hitscan raycasting
│   ├── bots.js         # AI bots: patrol/chase, shooting, infection
│   ├── pickups.js      # Health/ammo/weapon pickups + enemy drops
│   ├── effects.js      # Particles, explosions, screen shake
│   ├── audio.js        # Synthesized Web Audio sounds (no audio files)
│   ├── ui.js           # HUD, minimap, menus, mobile controls
│   └── story.js        # Wave system (CoD Zombies style)
└── ARCHITECTURE.md     # This document
```

## 2. Module Dependencies

```
main.js
 ├── config.js
 ├── world.js
 ├── player.js
 ├── weapons.js
 ├── bots.js
 ├── pickups.js
 ├── effects.js
 ├── audio.js
 ├── ui.js
 └── story.js
```

- `main.js` is the orchestrator. It constructs every subsystem and passes shared references (scene, world, effects, audio) into them.
- `bots.js` and `weapons.js` both read `scene.userData.bots` for the live bot list.
- `ui.js` holds a `this.game` back-reference (passed in constructor) to query live state (e.g. infected count).

## 3. Game State Machine

`main.js` drives a simple state machine:

| State      | Meaning                                        |
|------------|------------------------------------------------|
| `menu`     | Start screen                                   |
| `hiding`   | 15s hide countdown before wave 1 (bots patrol) |
| `playing`  | Active combat                                  |
| `paused`   | Pause menu                                     |
| `gameover` | Player died                                    |

The `_animate` loop calls `_update(dt)` for `playing`, `hiding`, and `paused` states.

## 4. World Generation

- **World size:** `CONFIG.worldSize = 55` (half-extent), so the playable area is 110×110 units. `WORLD_HALF = CONFIG.worldSize`.
- **Buildings:** `CONFIG.buildingCount = 18` hollow, enterable buildings. Each has:
  - 4 walls with a glowing door gap on the front wall
  - **Multi-story interior** with discrete floor slabs (`FLOOR_HEIGHT = 3.5` per story)
  - **Switchback stairs** that alternate direction per floor, staying inside the interior footprint
  - Glowing windows
  - **Variety:** each building picks a random style from a palette (blue, magenta, green, amber, purple, grey) with varied footprints (8–20 units) and heights (8–16 units).
- **Stair generation:** Each story has a single-flight staircase running along the back interior wall. Flights alternate sides per floor (switchback). Stair constants: `STEP_H = 0.25` riser, `STEP_D = 0.35` tread, `STAIR_W = 1.4` width. Each floor slab is built in sections around a stairwell cutout so climbing entities don't collide with the ceiling from below.
- **Colliders:** walls are stored in `world.obstacles` as AABBs `{ minX, maxX, minZ, maxZ, height }`. Walkable surfaces (floors, stairs, roofs) are in `world.platforms` as `{ minX, maxX, minZ, maxZ, topY }`.
- **Line of sight:** `hasLineOfSight(from, to)` is **height-aware** — it samples the ray at chest height and only treats a wall as blocking if it rises above the sight line. This prevents bots shooting through walls/roofs.

## 5. Player

- **Movement:** WASD, mouse look, Shift sprint (stamina-gated), Space jump, R reload.
- **Health:** `maxHealth = 100`. Regenerates after `regenDelay` seconds.
- **Stamina:** drains while sprinting, regenerates after a delay.
- **Low-health effects:**
  - Below 50% health, a persistent red vignette tint intensifies as health drops.
  - Movement slows down (down to 0.6× speed) as health drops below 50%.
- **Stairs:** auto-step uses smooth interpolation (not snapping) to avoid jitter. Stairs are built as multi-story switchback flights with per-step treads and walkable platform colliders.

## 6. Weapons

- **Rifle, SMG, Shotgun, Sniper** (switch with 1–4 or scroll), plus **Knife** and **Machete** melee.
- Player starts with **only the knife**; guns/machete are found as pickups.
- Hitscan raycasting with proper ray-sphere hit detection against bot body centers.
- Sniper has a zoom scope.

## 7. Bots & Infection

- **Civilians (uninfected):** Passive NPCs that patrol the streets "normally." They pick walkable patrol targets (not inside walls), detect when stuck and pick a new target, and never chase or attack the player.
- **Infection ("the other"):** On wave 1, `setupInfection()` marks 1 bot as infected. Infected bots:
  - Blend in visually (only a subtle green visor tint).
  - **Sneak toward the player** as their primary goal, infecting any NPC they pass along the way.
  - Move 1.3× faster.
  - Infect other bots on contact; **more infected = faster spread**.
  - Damage the player on contact.
- A ☣ counter in the top-right shows how many NPCs are infected.
- **Spotlight reveal:** When any NPC fires, the sweeping spotlight locks onto them and a glowing magenta ring (visible through walls) marks their position for a few seconds, plus a larger highlight on the minimap.

## 8. Audio

- **Synthesized Web Audio** — zero audio files. Gunshots, impacts, footsteps, pickups, and a peaceful ambient music loop.
- **Separate buses:** Music and SFX each route through their own gain node, so they can be toggled independently.
- **Menu toggles:** The start menu has **MUSIC: ON/OFF** and **SFX: ON/OFF** buttons.

## 9. Waves (Story)

- CoD Zombies-style wave system. Wave enemy count = `6 * 1.4^(wave-1)`, capped at 100.
- Intermission between waves, then a new wave spawns.

---

# Rules of the Match

1. **Objective:** Survive the waves. Eliminate bots to score points (+100 per kill).
2. **Start:** You begin with only a knife. Find guns and the machete scattered as pickups.
3. **Hide phase:** At the start, a 15-second hide countdown runs. Bots only patrol during this phase — use it to find a weapon and cover.
4. **Everyone blends in:** All NPCs look like casual civilians (varied street clothes, no helmets, no visible guns). You can't tell who's hostile just by looking — you have to watch their behavior.
5. **Infection:** One NPC is secretly "the other." It infects other NPCs on contact. Watch the ☣ counter — if it climbs, the horde is turning. Infected NPCs are faster and will hunt you. Only infected NPCs are safe to shoot.
6. **Don't shoot civilians:** If you shoot and kill an innocent (non-infected) civilian, it's **game over**.
7. **Spotlight reveal:** When any NPC fires, the sweeping spotlight locks onto them and a glowing ring shows their position through walls and on the minimap for a few seconds.
8. **Health:** You have 100 HP. When below 50%, the screen tints red and you move slower. Find health pickups to recover.
9. **Death:** If your health reaches 0, the match ends.
10. **Waves:** Each wave brings more enemies. Survive as long as you can.