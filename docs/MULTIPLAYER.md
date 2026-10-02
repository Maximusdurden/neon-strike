# Neon Strike — Multiplayer (Implemented)

> **Status: IMPLEMENTED & LIVE** — PeerJS WebRTC, host-authoritative, zero server code.
> Play it at https://maximusdurden.github.io/neon-strike/ — host a room, share the 4-letter code, and a friend anywhere in the world can join.

---

## 1. What's Implemented

Neon Strike is a **social-deduction shooter**: one player hunts "The Other" (infected) among a crowd of NPCs. Multiplayer adds two modes on top of the solo experience:

### Mode A — 1V1 VS FRIEND (PVP)
- Two hunters on the same map, competing to eliminate the infected.
- Both players share the same NPC population + infection state.
- **Bots chase whoever is closest** — the host player or the rival.
- You can shoot your opponent (30 damage per hit). Killing an innocent civilian disqualifies **only the shooter**.
- **Win**: your opponent is eliminated (by you or the infected).

### Mode B — 2-PLAYER CO-OP
- Two hunters working together.
- **Shared loss**: if either player shoots an innocent, both lose.
- **Revive system**: if one player goes down, the other has **15 seconds** to stand within 3m and press **F** to revive them. If the timer expires, it's game over.
- **Win**: all infected eliminated.

### Architecture choice: Host-authoritative (not a Node server)

The original plan considered a Node.js authoritative server. We went with **host-authoritative WebRTC** instead:

| Approach | Chosen? | Why |
|----------|---------|-----|
| **Authoritative Node server** | ❌ | Requires npm, a server process, and LAN IP entry — friction for players |
| **Host-authoritative (PeerJS)** | ✅ | Zero server code, works over the internet, one player runs the sim |
| **P2P / WebRTC** | ✅ (via PeerJS) | PeerJS handles NAT traversal + reliable ordering for us |

**How it works:**
- The **host** runs the full simulation (bots, infection, pickups, environment) and broadcasts 30Hz state snapshots.
- The **client** is render-only — it animates what it receives and sends input/action packets.
- **Seeded world**: the host picks a seed (mulberry32 PRNG), the client rebuilds the *identical* city.

---

## 2. Networking Protocol (PeerJS, JSON)

### Host → Client

| Message | Payload | Purpose |
|---------|---------|---------|
| `init` | `{ mode, seed, startingNPCs, raining }` | Match config — client rebuilds the world with the seed |
| `state` (30Hz) | `{ p: [x,y,z,yaw], infCount, bots: [[id,x,y,z,yaw,flags]], pickups: [[idx,active]] }` | Full world snapshot. Bot flags: 1=infected, 2=tagged, 4=revealed, 8=dead |
| `botkilled` | `{ id, infected }` | Client-fired kill reflection + score credit |
| `tagged` | `{ id }` | Client-tag reflection |
| `damaged` | `{ amount }` | Client player took damage |
| `hit` | `{}` | Client shot hit the host |
| `weapon` | `{ key }` | Client acquired a weapon pickup |
| `revived` | `{}` | Partner was revived |
| `gameover` | `{ reason }` | Shared loss / win |

### Client → Host

| Message | Payload | Purpose |
|---------|---------|---------|
| `player` (30Hz) | `{ p: [x,y,z], yaw }` | Client position (renders as rival in PVP, tracks partner in co-op) |
| `action` | `{ act: fire/tag/shove, origin, dir, weapon }` | Combat actions — host resolves hits |
| `interact` | `{ p: [x,y,z] }` | Fuse boxes, car alarms, trash cans, co-op revive |
| `collect` | `{ id }` | Pickup collection request |
| `downed` | `{}` | Co-op: I'm down, come revive me |

---

## 3. Key Implementation Details

### Seeded world generation
`world.js` exports `mulberry32(seed)` — a deterministic PRNG. Every procedural placement (buildings, crates, barriers, cars, trash cans, pickups) routes through `world._rand`. The host picks a seed in `hostRoom()`, sends it in `init`, and the client calls `world.build(seed)` before starting. Both sides get the **exact same city**.

### Render-only client
`bots.renderOnly`, `weapon.authoritative`, and `pickups.renderOnly` flags flip on the client:
- Bots skip AI/spawning/infection/damage — they only animate limbs + infected tells from snapshots
- Weapons don't resolve hits locally — they send `action` packets
- Pickups don't collect locally — they send `collect` requests

### Co-op revive
- Player death in co-op → `_downed = true` with a 15s timer (configurable via `CONFIG.coop`)
- Partner revives by standing within 3m + pressing **F**
- Host tracks the partner's position via `_partnerPos` (no rival mesh in co-op)
- Timer expiry → "NO ONE CAME TO REVIVE YOU"

### PVP bots target the nearest player
`bots.update(dt, player, hiding, rival)` — infected bots pick the nearest alive target. The rival has a `damage()` method and an `onRivalKilled` callback that notifies the client.

---

## 4. File Map

```
js/network.js      # NetworkManager: createRoom/joinRoom, PeerJS wrapper
js/main.js         # Game class: hostRoom/joinRoom, _onNetworkMessage,
                   #   _applyHostState, _applyClientAction, broadcastState
js/world.js        # mulberry32 seed, build(seed), seeded placement
js/bots.js         # renderOnly flag, rival targeting, onRivalKilled
js/weapons.js      # authoritative flag
js/pickups.js      # renderOnly flag, onCollect callback, seeded placement
index.html         # PeerJS CDN, mode selection, lobby UI
```

---

## 5. Future Ideas (not yet implemented)

- **3–4 player support** — the protocol is 1-host/1-client; extending to N clients means broadcasting to all connections
- **Player names** — currently the rival is just "RIVAL"/"HUNTER"
- **Hunter-vs-Infected mode** — one player secretly controls the infected swarm
- **Host migration** — if the host leaves, another player takes over the simulation
- **Match timer** — matches currently run until win/lose naturally