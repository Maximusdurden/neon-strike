# Neon Strike — Multiplayer Plan (v1: LAN Co-op / Social Deduction)

> **Status: PLANNING — no code written yet.**
> Goal: run a server on localhost, allow anyone on the same network to join and play together.

---

## 1. What "Multiplayer" Means for This Game

Neon Strike is a **social-deduction shooter**: one player hunts "The Other" (infected) among a crowd of NPCs. Multiplayer opens two natural modes:

### Mode A — Co-op Hunters (recommended first)
- 2–4 players all play as **hunters** on the same map.
- Everyone shares the same NPC population + infection state.
- Any player can shove/tag/shoot suspects. Killing an innocent = **that player** gets game-over (or a shared penalty).
- The infected spread is global — all players see the same infected count.
- **Win condition**: all infected eliminated. **Lose**: all hunters dead, or too many innocents killed.

### Mode B — Hunter vs Infected (later)
- One player is secretly "The Other" and controls the infected swarm.
- The infected player sees through infected eyes / gets a top-down view.
- Much more complex — defer until Mode A is solid.

**Recommendation: build Mode A first.** It reuses the existing single-player simulation almost entirely — the server just needs to sync player positions + shared state.

---

## 2. Architecture

### Current (single-player)
```
Browser (index.html)
  └── main.js (Game) — owns EVERYTHING: world, bots, player, weapons, pickups
```

### Target (multiplayer, authoritative server)
```
┌─────────────┐   WebSocket (ws://)   ┌──────────────────┐
│  Browser A  │◄─────────────────────►│                  │
│  Browser B  │◄─────────────────────►│   Node.js Server │
│  Browser C  │◄─────────────────────►│  (authoritative) │
└─────────────┘                       └──────────────────┘
```

**Key decision: authoritative server vs. client-authoritative.**

| Approach | Pros | Cons |
|----------|------|------|
| **Authoritative server** (recommended) | No cheating, single source of truth for infection/bots, easy to keep everyone in sync | More server code; bots/world run on server |
| **Host-authoritative** (one player is host) | No separate server process; host runs the sim | Host has advantage; host leaving kills the game |
| **P2P / WebRTC** | No server at all | Way more complex (reliable ordering, NAT traversal); overkill for LAN |

**Recommendation: authoritative Node.js server.** It's the cleanest for a LAN game and matches how the game already works (one simulation, many observers).

---

## 3. What the Server Runs vs. What Clients Run

### Server (Node.js, authoritative)
- **World simulation**: buildings, bots (NPCs), infection spread, pickups, fuse boxes, cars, trash cans.
- **Bot AI**: the entire `bots.js` update loop runs server-side.
- **Player state**: positions, health, weapons, kills, score.
- **Game rules**: hide phase, infection seeding, win/lose conditions.
- **Broadcast**: sends world state to all clients at ~20–30 Hz.

### Client (browser)
- **Rendering**: three.js scene, meshes, animations, particles, audio.
- **Local player input**: WASD/mouse → sends input to server (or sends position).
- **Prediction**: local player moves instantly (client-side prediction), server reconciles.
- **Remote players**: rendered as humanoid meshes (reuse the bot humanoid builder!) with name tags.

---

## 4. Networking Protocol (WebSocket, JSON)

### Client → Server (input, ~30 Hz)
```json
{ "type": "input", "seq": 42, "move": [0.3, -0.8], "yaw": 1.2, "pitch": -0.1, "sprint": true, "crouch": false, "jump": false, "fire": false, "shove": false, "interact": false }
```

### Server → Client (state, ~20–30 Hz)
```json
{
  "type": "state",
  "tick": 1234,
  "players": [
    { "id": "a1", "pos": [1.2, 1.7, 3.4], "yaw": 0.5, "pitch": -0.2, "health": 85, "weapon": "rifle", "alive": true, "name": "Dexter" }
  ],
  "bots": [
    { "id": 0, "pos": [5.1, 0, 2.2], "infected": false, "alive": true }
  ],
  "infectedCount": 3,
  "pickups": [ { "id": 0, "pos": [1, 1.2, 2], "active": true } ],
  "events": [ { "type": "infection", "botId": 7 }, { "type": "kill", "playerId": "a1", "botId": 7 } ]
}
```

**Why events + state?** State snapshots keep everyone in sync; events (infection, kills, fuse cuts, alarms) trigger one-shot audio/visual effects on clients without waiting for the next snapshot.

---

## 5. Server Tech Stack

| Piece | Choice | Why |
|-------|--------|-----|
| Runtime | **Node.js** | Same JS as the game — can reuse `bots.js`, `world.js`, `config.js` logic directly |
| WebSocket | **`ws`** (npm) | Minimal, battle-tested |
| HTTP | **Node built-in `http`** or **Express** | Serve the static game files + upgrade to WS |
| Shared code | **`shared/` folder** | `config.js`, `bots.js`, `world.js` move here; both server and client import them |
| No build step | Keep ES modules | Node 20+ supports ESM natively; browser uses import map |

**Project layout after refactor:**
```
neon-strike/
├── server/
│   ├── index.js        # HTTP + WebSocket server
│   ├── game.js         # authoritative game loop (runs bots/world)
│   └── package.json    # deps: ws
├── shared/
│   ├── config.js       # moved from js/
│   ├── world.js        # moved from js/ (server simulates, client renders)
│   ├── bots.js         # moved from js/ (server simulates)
│   └── protocol.js     # message types + validation
├── js/                 # client-only: rendering, input, UI, audio
│   ├── main.js
│   ├── player.js       # local controller + prediction
│   ├── net.js          # WebSocket client
│   └── ...
└── index.html
```

---

## 6. LAN Networking Details

- Server binds to `0.0.0.0:8123` (all interfaces) so other machines on the network can connect.
- Clients connect to `ws://<host-ip>:8123` — the host's LAN IP (e.g. `192.168.1.50`).
- **Discovery**: simplest is a "JOIN GAME" screen where you type the host's IP. (mDNS/Bonjour auto-discovery is a nice-to-have later.)
- **Firewall**: Windows will prompt to allow Node through the firewall on first run — user must click Allow.
- **Latency**: LAN is ~1–5ms, so 20–30 Hz snapshots + client prediction will feel near-instant.

---

## 7. Refactor Steps (what changes in the existing code)

1. **Extract shared simulation** — move `config.js`, `world.js`, `bots.js` (the simulation parts) into `shared/`. Client keeps rendering-only code.
2. **Server game loop** — `server/game.js` runs `World` + `Bots` at a fixed tick (e.g. 30 Hz), applies player inputs, broadcasts snapshots.
3. **Client net layer** — `js/net.js` connects, sends inputs, applies snapshots to the local scene.
4. **Remote player rendering** — reuse `_buildHumanoid()` from `bots.js` to render other players; add name tags (CSS sprites).
5. **Local player prediction** — keep the existing `player.js` movement locally; server reconciles position if it disagrees.
6. **Game flow** — lobby screen (host/join), ready-up, then the match starts for everyone simultaneously.
7. **UI** — add "HOST GAME" / "JOIN GAME" to the menu; show player list + names in HUD.

---

## 8. Scope & Milestones

### Milestone 1 — "Two players, one map" (core)
- [ ] Server runs the full simulation (bots, infection, pickups)
- [ ] Two clients connect, see each other as humanoids with name tags
- [ ] Both can move/shove/tag/shoot; server resolves hits
- [ ] Shared infection state (both see the same infected count)
- [ ] LAN join via IP entry

### Milestone 2 — "Co-op hunt" (polish)
- [ ] Win/lose conditions (all infected dead = win; all hunters dead = lose)
- [ ] Kill feed shows which player did what
- [ ] Player death → spectator mode (watch teammates)
- [ ] Reconnect / host migration (if host leaves, another takes over)

### Milestone 3 — "The Other is a player" (stretch)
- [ ] One player secretly controls the infected
- [ ] Infected player gets special vision/controls
- [ ] Balance pass on infection spread vs. multiple hunters

---

## 9. Open Questions for You

Before I write any code, I need your input on these:

1. **Mode**: Start with **Co-op Hunters** (all players hunt the infected together)? Or do you want Hunter-vs-Infected (one player IS the Other) from the start?

2. **Player count**: How many players max? (2, 4, 8?) This affects map size and infected balance.

3. **Friendly fire**: If a player shoots an innocent civilian, should it be:
   - (a) That player dies instantly (current single-player rule)
   - (b) That player gets a penalty (lose points, brief stun)
   - (c) Shared penalty for the whole team

4. **Death**: When a hunter dies, should they:
   - (a) Spectate until the match ends
   - (b) Respawn after a timer
   - (c) Respawn only if a teammate revives them

5. **Server hosting**: Are you OK with a **Node.js server** (requires `npm install ws` and running `node server/index.js`)? Or do you want zero-dependency (raw WebSocket in Node's built-in `http` — no npm at all)?

6. **Match length**: Should matches have a time limit, or run until win/lose naturally?

7. **Names**: Do players pick a name in the lobby, or use a default like "Player 1"?

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Refactoring breaks single-player | Keep single-player mode working; server mode is an opt-in path |
| Bot AI on server is heavy | 60 NPCs at 30 Hz is trivial for Node; can drop to 20 Hz if needed |
| Cheating (client sends fake position) | Authoritative server ignores client positions for bots; only inputs are trusted |
| Host firewall blocks connections | Document the firewall allow step; test on LAN |
| WebSocket vs. HTTP on same port | Use `http` server + `ws` upgrade on the same port (standard pattern) |

---

**Next step:** Answer the 7 questions above and I'll write the detailed implementation plan + start on Milestone 1.