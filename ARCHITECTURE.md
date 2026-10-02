# UNASSIMILATED — Architecture & Rules of the Match

*Trust No One. Silence Is Survival.*

A procedural 3D first-person social-deduction shooter built with **three.js** (v0.160.0, loaded via CDN import map). No build tools, no npm — pure ES modules served over a static HTTP server.

---

## 1. Project Layout

```
neon-strike/
├── index.html          # Entry point: import map, HUD, overlays, script tag
├── css/style.css       # All styling (HUD, scope, vignette, counters, etc.)
├── js/
│   ├── config.js       # Central tuning constants + WORLD_HALF export
│   ├── main.js         # Game class: state machine, update loop, wiring
│   ├── world.js        # Procedural city: buildings, stairs, crates, LOS, stadium
│   ├── player.js       # FPS controller: movement, camera, health, stamina, flashlight
│   ├── weapons.js      # Multi-weapon system + hitscan raycasting
│   ├── bots.js         # AI bots: patrol/chase, shooting, infection, vertical sensing
│   ├── pickups.js      # Health/ammo/weapon/perk pickups + enemy drops
│   ├── effects.js      # Particles, explosions, screen shake
│   ├── audio.js        # Synthesized Web Audio sounds (no audio files)
│   ├── ui.js           # HUD, minimap, menus, mobile controls
│   └── story.js        # Population milestones + lore banners
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
- **Under-stair infill:** Every flight's underside is enclosed with solid geometry and registered as a full-height wall collider, creating an impenetrable under-stair closet boundary — no clipping into the open wedge beneath the stairs.
- **Colliders:** walls are stored in `world.obstacles` as AABBs `{ minX, maxX, minZ, maxZ, height }`. Walkable surfaces (floors, stairs, roofs) are in `world.platforms` as `{ minX, maxX, minZ, maxZ, topY }`.
- **Ground height:** `getGroundHeight(x, z, feetY)` strictly ignores any surface where `topY > feetY + stepHeight + 0.05`, preventing upward snapping through overhead flights.
- **Line of sight:** `hasLineOfSight(from, to)` is **height-aware** — it samples the ray at chest height and only treats a wall as blocking if it rises above the sight line. This prevents bots shooting through walls/roofs.
- **Stadium floodlights:** 4 industrial light pylons at (X, Z = ±45m), height 28m, OFF by default. A central circuit breaker at (0,0) requires a 3.0s hold (E) to activate, flooding the arena with daylight illumination.

## 5. Player

- **Movement:** WASD, mouse look, Shift sprint (stamina-gated), Space jump, R reload.
- **Health:** `maxHealth = 100`. Regenerates after `regenDelay` seconds.
- **Stamina:** drains while sprinting, regenerates after a delay.
- **Flashlight:** camera-attached `THREE.SpotLight` (`0xfffaed`, intensity 2.5, 30m, `π/7` angle), toggled with **F**. When ON, the player's visibility distance expands to 35m across a 45° forward cone.
- **Sensory perks:** discovered in the environment (not baseline). `sixthSense` (neural radar pulse within 14m), `thermal` (crosshair micro-tell highlight), `softSoles` (halved footstep noise), `adrenaline` (10s of no-stamina-drain + 1.25× sprint).
- **Noise radii:** crouch-walk 0m (fully silent), standard walk 5m, sprint 18m. Soft Soles halves these. Silent melee takedowns emit only 1m.
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
- **Infection ("the vector"):** On hunt start, `setupInfection()` marks 1 bot as infected. Infected bots:
  - Blend in visually (only a subtle green visor tint).
  - **Sneak toward the player** as their primary goal, infecting any NPC they pass along the way.
  - Move 1.3× faster.
  - Infect other bots on contact; **more infected = faster spread**.
  - Damage the player on contact — **only with horizontal proximity AND tight vertical alignment** (a bot below a floor slab can't hit through the ceiling).
- **Vertical sensory blindness:** Bots can't sense or track the player through a floor slab. If a bot lacks line of sight and the vertical separation exceeds 2.2m, it can't acquire the player unless the player's `noiseRadius >= 15` (sprinting, jumping, or unsuppressed gunfire). Ducking or stationary players on roofs are undetectable to bots below.
- A ☣ counter in the top-right shows how many NPCs are infected.
- **Spotlight reveal:** When any NPC fires, the sweeping spotlight locks onto them and a glowing magenta ring (visible through walls) marks their position for a few seconds, plus a larger highlight on the minimap.
- **Flashlight reaction:** When the player's flashlight is ON, any bot with LOS inside the 35m/45° beam cone turns to face the source; infected thralls abandon their routes and sprint toward the beam.
- **Stadium floodlights:** When the grid is ON, bot visual acquisition extends to maximum map boundaries and every infected is drawn to the central generator.

## 8. Audio

- **Synthesized Web Audio** — zero audio files. Gunshots, impacts, footsteps, pickups, and a peaceful ambient music loop.
- **Separate buses:** Music and SFX each route through their own gain node, so they can be toggled independently.
- **Menu toggles:** The start menu has **MUSIC: ON/OFF** and **SFX: ON/OFF** buttons.

## 9. Waves (Story)

- CoD Zombies-style wave system. Wave enemy count = `6 * 1.4^(wave-1)`, capped at 100.
- Intermission between waves, then a new wave spawns.

---

# Rules of the Match

1. **Objective:** Survive the neighborhood. Eliminate Threaded hosts to earn Extraction Bounty. Find and eliminate The Vector before The Weave converts everyone.
2. **Start:** You begin with only a knife. Find guns, the machete, and sensory perks scattered as pickups.
3. **Hide phase:** At the start, a 15-second hide countdown runs. Bots only patrol during this phase — use it to find a weapon and cover.
4. **Everyone blends in:** All NPCs look like casual residents (varied street clothes, no helmets, no visible guns). You can't tell who's hostile just by looking — you have to watch their behavior.
5. **Infection:** One NPC is secretly The Vector. It infects other NPCs on contact. Watch the ☣ counter — if it climbs, the horde is turning. Infected NPCs are faster and will hunt you. Only infected NPCs are safe to shoot.
6. **Don't shoot civilians:** If you shoot and kill an innocent (non-infected) resident, it's **game over** — *COVER BLOWN: CIVILIAN CASUALTY*.
7. **Spotlight reveal:** When any NPC fires, the sweeping spotlight locks onto them and a glowing ring shows their position through walls and on the minimap for a few seconds.
8. **Vertical awareness:** Bots can't sense or damage you through floor slabs. If you're more than 2.2m above a bot with no line of sight, you're invisible to it — unless you're sprinting or firing.
9. **Flashlight:** Toggle with **F**. The beam reveals you from 35m inside a 45° cone — infected thralls sprint toward it.
10. **Stadium Floodlights:** Hold **E** at the central breaker for 3s to flood the arena with daylight. Stealth drops to zero, but every infected is drawn to the generator.
11. **Black-Box Uplinks:** Multiplier beacons spawn every 30s for 10s. Collect them to boost your bounty: 2x → 3x → 4x → 5x → Apex.
12. **Pressure Scoring:** Bounty rate = `(5 + infected × 2.5) × multiplier` pts/sec. Kill bounty = `(100 × multiplier) + infected × 10`.
13. **Health:** You have 100 HP. When below 50%, the screen tints red and you move slower. Find health pickups to recover.
14. **Death:** If your health reaches 0, the match ends.