# Neon Strike

A polished, modular 3D first-person shooter built with **three.js** — no build tools, no dependencies beyond a single CDN import. Runs in any modern browser, desktop and mobile.

Built to be *better* than the viral "Opus 5.5" demo: clean architecture, real gameplay systems, synthesized audio, and a proper HUD — all in a small, readable codebase.

## Features

- **Procedural neon city** — buildings, streets, terrain, skybox, day-night cycle, weather (rain + fog)
- **First-person controls** — WASD + mouse look, sprint, jump, gravity, collision
- **Weapon system** — hitscan rifle with recoil, spread, muzzle flash, tracer, reload
- **Destructible environment** — crates that break into debris
- **AI bots** — patrol, chase, and shoot the player
- **Pickups** — health and ammo
- **Particles & feedback** — explosions, impact sparks, screen shake, hit markers
- **Synthesized audio** — Web Audio API, zero audio files (gunshots, impacts, footsteps, ambient music)
- **HUD** — health, ammo, crosshair, kill feed, minimap, score
- **Mobile support** — touch joystick + fire button
- **Menu & game states** — start, playing, game over

## Run it

Serve the folder (three.js is loaded from CDN, so a static server is enough):

```bash
# from the neon-strike folder
python -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a browser.

## Controls

| Action | Desktop | Mobile |
|--------|---------|--------|
| Move | WASD | Left joystick |
| Look | Mouse | Drag right side |
| Fire | Left click / Space | Fire button |
| Sprint | Shift | — |
| Jump | Space | Jump button |
| Reload | R | Reload button |
| Pause | Esc | — |

## Architecture

```
neon-strike/
├── index.html          # Entry point, loads modules
├── css/style.css       # HUD, menu, mobile UI styling
├── js/
│   ├── config.js       # Central tuning constants
│   ├── main.js         # Game class: loop, state, wiring
│   ├── world.js        # Procedural city, sky, weather, day-night
│   ├── player.js       # First-person controller + camera
│   ├── weapons.js      # Weapon, hitscan, projectiles, tracers
│   ├── bots.js         # AI enemies
│   ├── pickups.js      # Health/ammo pickups
│   ├── effects.js      # Particles, explosions, screen shake
│   ├── audio.js        # Synthesized Web Audio SFX + music
│   └── ui.js           # HUD, minimap, menu, mobile controls
```

## License

MIT
