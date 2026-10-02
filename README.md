# UNASSIMILATED

*Trust No One. Silence Is Survival.*

A polished, modular 3D **social-deduction shooter** built with **three.js** — no build tools, no dependencies beyond CDN imports. Runs in any modern browser, desktop and mobile. **Play it live: https://maximusdurden.github.io/neon-strike/**

---

## 🎯 The Core Concept: You vs. The Assumed

You are **Vance**, a deep-cover operative inserted into the suburban enclave of **Blackwood Ridge**. Somewhere in the crowd, **The Vector** hides — an infected host that looks exactly like every other resident. Your job: find it and eliminate it before **The Weave** converts the whole neighborhood.

But here's the tension that makes it a *social-deduction* game:

- **The Threaded spread.** Every infected can convert nearby residents. The neighborhood is a ticking clock — the longer you take, the more of them there are.
- **Firing your weapon is a gamble.** Gunshots are *loud*. The spotlight locks onto your position, and **every infected on the map homes in on the sound**. Shooting reveals you to the horde. Sometimes the knife is the smarter tool.
- **Killing an innocent is game over.** You can't just shoot everyone to be safe. Tag suspects (E), shove them (V), watch their tells — and only pull the trigger when you're sure.
- **The horde is always hunting.** Infected chase you, flank through doors, and spread among the crowd. The heartbeat in the music tells you how close they are.

Every mode is this same core loop with a different twist:

| Mode | The Twist |
|------|-----------|
| **SOLO SURVIVAL** | Classic hunt. Find The Vector before the neighborhood falls |
| **1V1 VS AI HUNTER** | A rival AI hunter hunts *you* — it paths through doors, homes to your gunfire, attacks on contact. Kill it to win |
| **1V1 VS FRIEND (PVP)** | Two hunters, one city. Host a room, share the 4-letter code. Bots chase whoever is closest — out-hunt your friend |
| **2-PLAYER CO-OP** | Hunt together. If one of you goes down, the other has **15 seconds** to revive them (stand close + press **F**) |

**Multiplayer** uses PeerJS WebRTC — no server needed, works over the internet. The host runs the simulation; the client is render-only and receives 30Hz state snapshots.

---

## 🕵️ How to Find "The Vector" — Color & Audio Tells

The Threaded blend in with residents, but they leak tells. Learn to read them:

### Color tells

| Tell | When | What to look for |
|------|------|------------------|
| **Green visor glow** (`#00ff88`) | **Night only** | The infected's visor lights up neon green in the dark. During the day it stays dark so they blend in |
| **Pink aura ring** (`#ff2d78`) | **Day only** | In daylight, a faint pulsing pink ring appears at the infected's feet — subtle, but readable if you watch closely |
| **Pink reveal glow** (`#ff2d78`) | When a bot fires | Any bot that shoots is briefly revealed through walls with a pink glow for 4 seconds |
| **Tag beacon** | When you tag (E) | Your scanner pings the target with a beacon so you can track it |

### Audio tells

| Sound | When | Meaning |
|-------|------|---------|
| **Heartbeat / sub-drop thud** | Threat level > 0.45 | The music shifts from a tense stealth drone to a **panic pursuit track** with a pounding sub-bass heartbeat. The closer the infected get, the louder and faster it pulses |
| **Binaural whisper** | Within 6m of The Vector | A low, phase-shifted sub-bass hum (55Hz vs 55.8Hz) panned left/right — creates a disorienting "beating" effect that tells you The Vector is very close |
| **Cold-breath vapor** | Every 8–12s | Infected exhale faint green vapor puffs — a visual tell that rewards patient observation |
| **Creaky stairs** | Walking on wooden stairs | Wooden risers creak (and alert nearby bots) — crouch-walking is silent |
| **Thuds from below** | On upper floors | If a chasing infected is on the ground floor below you, you hear muffled rhythmic thuds |

### Other gameplay systems

- **Shove (V)** — non-lethal push. Shoving an infected breaks its disguise (hiss + reveal); shoving a civilian just makes them angry
- **Tag (E)** — the Neural Resonance Probe marks a suspect. Infected = "TARGET CONFIRMED: THE WEAVE DETECTED", innocent = "TARGET SCAN: UNINFECTED CIVILIAN"
- **Interact (F)** — fuse boxes (cut a building's lights), car alarms & trash cans (loud distractions that draw bots), and **revive downed co-op partners**
- **Flashlight (F)** — a camera-attached tactical beam, toggled with a tap of **F**. When ON, you're visible from 35m inside a 45° forward cone; infected thralls sprint toward the beam
- **Stadium Floodlights** — **hold F** at the central circuit breaker for 3s to flood the arena with daylight. Stealth concealment drops to zero, but every infected is drawn to the generator
- **Sensory Perks** — passive detection is now *discovered*, not baseline. Find **Sixth Sense** (neural radar), **Thermal Scanner**, **Soft Soles** (halved footsteps), and **Adrenaline Syringe** (10s of boosted sprint) hidden in the environment
- **Black-Box Uplinks** — multiplier beacons spawn every 30s for 10s. Collect them to boost your Extraction Bounty: 2x → 3x → 4x → 5x → Apex (random 2x–5x)
- **Pressure Scoring** — your bounty rate scales with active threat density: `(5 + infected × 2.5) × multiplier` pts/sec
- **Lean (Q/E)** — peek around corners
- **Adrenaline** — when threat is high, your FOV expands (75°→84°) with chromatic aberration for a panic feel
- **Infection spread** — the infected convert residents over time. The spread rate is capped globally so the neighborhood doesn't fall in seconds
- **Damage i-frames** — 0.8s invulnerability between hits so a single infected can't melt you

---

## 🎨 Visual & Audio Design

- **Film-grade color science** — ACES filmic tone mapping, balanced exposure, sRGB gamma
- **Procedural textures** — cross-stitch fabric weave, brick normal maps, wet asphalt with puddle roughness
- **Anatomical NPC rigs** — segmented torsos, capsule limbs, contact shadows, day/night infected tells
- **Sun-tracking glare** — a soft reflection pool follows the sweeping spotlight across wet asphalt
- **Synthesized audio** — 100% Web Audio API, zero audio files: gunshots, impacts, footsteps, ambient music, and the dynamic threat-based horror score
- **Day/night cycle** — 2-minute full cycle; the infected's tells flip between visor (night) and aura (day)

---

## 🎮 Controls

| Action | Desktop | Mobile |
|--------|---------|--------|
| Move | WASD | Left joystick |
| Look | Mouse | Drag right side |
| Fire | Left click | Fire button |
| Sprint | Shift | — |
| Jump | Space | Jump button |
| Crouch | Ctrl | — |
| Reload | R | Reload button |
| Tag suspect (Neural Probe) | E | — |
| Interact / Revive | F | — |
| Flashlight (tap F) | F | — |
| Shove | V | — |
| Lean | Q / E | — |
| Switch weapon | 1–6 / scroll | — |
| Pause / Options | Esc | — |

**All keybindings are remappable** — press Esc → Options → Keybinds.

---

## 🚀 Run It

### Play online (no install)
Just open **https://maximusdurden.github.io/neon-strike/**

### Run locally
Serve the folder (three.js loads from CDN, so any static server works):

```bash
# from the neon-strike folder — recommended: caching disabled
python serve.py 8000
# then open http://localhost:8000
```

`serve.py` is a zero-dependency dev server that sends `Cache-Control: no-store`
and the correct `text/javascript` MIME type. Plain `python -m http.server` also
works, but browsers may serve stale ES modules after you edit a file, so code
changes can appear to have no effect until a hard reload.

### Cache busting
`js/version.js` holds a single `ASSET_VERSION` string. It is appended as a query
string to every module import and to the entry script in `index.html`, so
browsers re-fetch the whole module graph when it changes. **Bump it whenever you
ship a change to any file under `js/`** — and keep the value in `index.html`'s
`<script src="js/main.js?v=...">` in sync.

### Deploy to GitHub Pages
The repo includes a GitHub Actions workflow (`.github/workflows/pages.yml`) that auto-deploys on every push to `main`. Enable Pages in repo settings → Source: **GitHub Actions**.

---

## 🏗️ Architecture

```
neon-strike/
├── index.html          # Entry point, import map, PeerJS CDN
├── serve.py            # Zero-dep dev server (caching disabled)
├── css/style.css       # HUD, menu, lobby, keybinds, mobile UI
├── js/
│   ├── version.js      # Single ASSET_VERSION cache-bust constant
│   ├── config.js       # Central tuning constants
│   ├── main.js         # Game class: loop, state, networking, wiring
│   ├── world.js        # Seeded procedural city, sky, weather, day-night
│   ├── player.js       # First-person controller, shove, lean, i-frames
│   ├── weapons.js      # 6 weapons, hitscan, zoom, melee
│   ├── bots.js         # AI civilians + infected (render-only mode for clients)
│   ├── pickups.js      # Health/ammo/weapon pickups (seeded placement)
│   ├── effects.js      # Particles, explosions, screen shake
│   ├── audio.js        # Synthesized Web Audio SFX + dynamic music
│   ├── ui.js           # HUD, minimap, menu, lobby, keybinds, bests
│   ├── keybinds.js     # Remappable keybind registry + persistence
│   ├── network.js      # PeerJS WebRTC host/client networking
│   └── textures.js     # Procedural fabric/brick/asphalt textures
└── docs/
    └── MULTIPLAYER.md  # Multiplayer architecture & protocol
```

### Multiplayer model (host-authoritative)
- **Host** runs the full simulation (bots, infection, pickups, environment) and broadcasts 30Hz state snapshots
- **Client** is render-only — it animates what it receives and sends input/action packets
- **Seeded world** — the host picks a seed, the client rebuilds the identical city (mulberry32 PRNG)
- See `docs/MULTIPLAYER.md` for the full protocol

---

## License

MIT
