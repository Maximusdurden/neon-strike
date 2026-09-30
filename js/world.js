// Procedural neon city: terrain, streets, buildings, crates, sky, weather, day-night.

import * as THREE from 'three';
import { CONFIG, WORLD_HALF } from './config.js';

// --- Building / stair generation constants ---
const FLOOR_HEIGHT = 3.5;   // meters per story
const STEP_H = 0.25;        // stair riser height
const STEP_D = 0.35;        // stair tread depth (along travel axis)
const STAIR_W = 1.4;        // stair width (across travel axis)

export class World {
  constructor(scene) {
    this.scene = scene;
    this.buildings = [];
    this.crates = [];
    this.obstacles = []; // colliders: { minX, maxX, minZ, maxZ, height }
    this.platforms = []; // walkable surfaces: { minX, maxX, minZ, maxZ, topY }
    this.doors = [];     // door openings: { x, z }
    this.clock = new THREE.Clock();
    this.rainParticles = null;
    this.rainGeo = null;
    this.rainMat = null;
    this.isRaining = false;

    this._buildLights();
    this._buildGround();
    this._buildCity();
    this._buildCrates();
    this._buildBarriers();
    this._buildSky();
    this._buildRain();
  }

  _buildLights() {
    // Brighter ambient lighting (Duke Nukem style — always visible)
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x445566, 1.0);
    this.scene.add(this.hemi);

    // The "sun" is a sweeping spotlight that patrols the arena.
    this.sun = new THREE.SpotLight(0xfff2cc, 1.6, 0, Math.PI / 5, 0.5, 1.5);
    this.sun.position.set(0, 60, 0);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -120;
    this.sun.shadow.camera.right = 120;
    this.sun.shadow.camera.top = 120;
    this.sun.shadow.camera.bottom = -120;
    this.sun.shadow.camera.far = 300;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // Sweep state
    this.spotAngle = 0;
    this.spotTarget = null;   // revealed bot to lock onto
    this.spotLockTimer = 0;

    // Fill light so shadows aren't pitch black
    this.fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    this.fill.position.set(-40, 30, -60);
    this.scene.add(this.fill);
  }

  _buildGround() {
    const geo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.9 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid lines for a neon feel
    const grid = new THREE.GridHelper(WORLD_HALF * 2, 40, 0x00e5ff, 0x00e5ff);
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    grid.position.y = 0.02;
    this.scene.add(grid);
  }

  _buildCity() {
    const spacing = CONFIG.streetWidth;
    const placed = [];
    let attempts = 0;
    // A palette of building styles for variety.
    const styles = [
      { wall: 0x2a3a52, floor: 0x3a4a62, accent: 0x00e5ff }, // blue
      { wall: 0x4a2a3a, floor: 0x5a3a4a, accent: 0xff2d78 }, // magenta
      { wall: 0x2a4a3a, floor: 0x3a5a4a, accent: 0x3bff8a }, // green
      { wall: 0x4a3a2a, floor: 0x5a4a3a, accent: 0xffd166 }, // amber
      { wall: 0x3a2a4a, floor: 0x4a3a5a, accent: 0x9b6bff }, // purple
      { wall: 0x3a3a3a, floor: 0x4a4a4a, accent: 0xffffff }, // grey
    ];
    while (placed.length < CONFIG.buildingCount && attempts < 500) {
      attempts++;
      // Vary footprint: some small, some large, some tall towers.
      const w = 8 + Math.random() * 12;
      const d = 8 + Math.random() * 12;
      const x = (Math.random() * 2 - 1) * (WORLD_HALF - 16);
      const z = (Math.random() * 2 - 1) * (WORLD_HALF - 16);
      const h = CONFIG.buildingMinH + Math.random() * (CONFIG.buildingMaxH - CONFIG.buildingMinH);
      const style = styles[Math.floor(Math.random() * styles.length)];

      // Keep buildings off the central plaza and off each other.
      if (Math.abs(x) < 12 && Math.abs(z) < 12) continue;
      let ok = true;
      for (const b of placed) {
        if (Math.abs(b.x - x) < (b.w + w) / 2 + spacing && Math.abs(b.z - z) < (b.d + d) / 2 + spacing) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      placed.push({ x, z, w, d, h });
      this._addBuilding(x, z, w, d, h, style);
    }
  }

  // Build a hollow, enterable building with walls, a door, multi-story floors,
  // and switchback stairs that stay inside the interior footprint.
  _addBuilding(x, z, w, d, h, style = {}) {
    const wallColor = style.wall || 0x2a3a52;
    const floorColor = style.floor || 0x3a4a62;
    const accentColor = style.accent || 0x00e5ff;
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor,
      roughness: 0.7,
      metalness: 0.3,
    });
    const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.8 });
    const windowMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.6 });
    const stairMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.8 });

    const wt = CONFIG.building.wallThick;
    const doorW = CONFIG.building.doorWidth;
    const doorH = CONFIG.building.doorHeight;
    const halfW = w / 2;
    const halfD = d / 2;

    // Discrete story heights
    const numFloors = Math.max(1, Math.floor(h / FLOOR_HEIGHT));
    const actualH = numFloors * FLOOR_HEIGHT;

    // --- Walls (4 sides), with a door gap on the front wall ---
    this._addWall(x, z - halfD, w, actualH, wt, wallMat, 'x');
    this._addWall(x - halfW, z, d, actualH, wt, wallMat, 'z');
    this._addWall(x + halfW, z, d, actualH, wt, wallMat, 'z');

    // Door gap on front wall: two wall segments flanking the door
    const doorHalf = doorW / 2;
    const leftSegLen = halfW - doorHalf;
    const rightSegLen = halfW - doorHalf;
    if (leftSegLen > 0) this._addWall(x - halfW + leftSegLen / 2, z + halfD, leftSegLen, actualH, wt, wallMat, 'x');
    if (rightSegLen > 0) this._addWall(x + doorHalf + rightSegLen / 2, z + halfD, rightSegLen, actualH, wt, wallMat, 'x');
    this._addWall(x, z + halfD, doorW, actualH - doorH, wt, wallMat, 'x', doorH);

    // Door mesh (visual) — make it obvious with a glowing frame
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.1), doorMat);
    door.position.set(x, doorH / 2, z + halfD);
    this.scene.add(door);
    const glowMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.15, doorH, 0.15), glowMat);
    frameL.position.set(x - doorW / 2, doorH / 2, z + halfD);
    this.scene.add(frameL);
    const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.15, doorH, 0.15), glowMat);
    frameR.position.set(x + doorW / 2, doorH / 2, z + halfD);
    this.scene.add(frameR);
    const frameT = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.15, 0.15), glowMat);
    frameT.position.set(x, doorH, z + halfD);
    this.scene.add(frameT);
    const arrowMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 4), arrowMat);
    arrow.position.set(x, doorH + 1.2, z + halfD);
    arrow.rotation.x = Math.PI; // point down
    this.scene.add(arrow);

    // Door opening colliders
    if (leftSegLen > 0) this._addWallCollider(x - halfW + leftSegLen / 2, z + halfD, leftSegLen, actualH, 'x');
    if (rightSegLen > 0) this._addWallCollider(x + doorHalf + rightSegLen / 2, z + halfD, rightSegLen, actualH, 'x');
    this._addWallCollider(x, z - halfD, w, actualH, 'x');
    this._addWallCollider(x - halfW, z, d, actualH, 'z');
    this._addWallCollider(x + halfW, z, d, actualH, 'z');
    this.doors.push({ x, z: z + halfD });

    // Ground floor
    const groundFloor = new THREE.Mesh(new THREE.BoxGeometry(w - wt * 2, 0.2, d - wt * 2), floorMat);
    groundFloor.position.set(x, 0.1, z);
    groundFloor.receiveShadow = true;
    this.scene.add(groundFloor);

    // Stairwell placement (anchored along the back interior wall)
    const stairSteps = Math.round(FLOOR_HEIGHT / STEP_H);
    const stairRunLength = stairSteps * STEP_D;
    const stairZ = z - halfD + wt + STAIR_W / 2 + 0.2;

    // Generate multi-story floors & switchback stairs
    for (let f = 1; f <= numFloors; f++) {
      const floorY = f * FLOOR_HEIGHT;
      const isRoof = (f === numFloors);
      const stairDir = (f % 2 === 1) ? 1 : -1;
      const stairStartX = (stairDir === 1)
        ? (x - halfW + wt + 0.5)
        : (x + halfW - wt - 0.5);

      // Build floor slab with stairwell gap
      this._addFloorSlabWithHole(x, z, w - wt * 2, d - wt * 2, floorY, stairStartX, stairZ, stairRunLength, STAIR_W, stairDir, floorMat);

      // Add stairs up to this floor from the previous floor
      this._addFloorStaircase(stairStartX, stairZ, floorY - FLOOR_HEIGHT, stairSteps, stairDir, stairMat);
    }

    this._addWindows(x, z, w, d, actualH, windowMat);
    this.buildings.push({ x, z, w, d, h: actualH });
  }

  // Generates a floor slab divided into sections around a stairwell cutout.
  _addFloorSlabWithHole(cx, cz, fw, fd, floorY, holeX, holeZ, holeLen, holeW, dir, mat) {
    const slabThick = 0.25;
    const holeMinX = Math.min(holeX, holeX + dir * holeLen) - 0.2;
    const holeMaxX = Math.max(holeX, holeX + dir * holeLen) + 0.2;
    const holeMinZ = holeZ - holeW / 2;
    const holeMaxZ = holeZ + holeW / 2;

    const minX = cx - fw / 2;
    const maxX = cx + fw / 2;
    const minZ = cz - fd / 2;
    const maxZ = cz + fd / 2;

    // Front slab (rest of the room in front of stairwell)
    const frontD = maxZ - holeMaxZ;
    if (frontD > 0.1) {
      const frontMesh = new THREE.Mesh(new THREE.BoxGeometry(fw, slabThick, frontD), mat);
      const posZ = holeMaxZ + frontD / 2;
      frontMesh.position.set(cx, floorY - slabThick / 2, posZ);
      this.scene.add(frontMesh);
      this.platforms.push({ minX, maxX, minZ: holeMaxZ, maxZ, topY: floorY });
    }

    // Left side filler
    const leftW = holeMinX - minX;
    if (leftW > 0.1) {
      const leftMesh = new THREE.Mesh(new THREE.BoxGeometry(leftW, slabThick, holeW), mat);
      leftMesh.position.set(minX + leftW / 2, floorY - slabThick / 2, holeZ);
      this.scene.add(leftMesh);
      this.platforms.push({ minX, maxX: holeMinX, minZ: holeMinZ, maxZ: holeMaxZ, topY: floorY });
    }

    // Right side filler
    const rightW = maxX - holeMaxX;
    if (rightW > 0.1) {
      const rightMesh = new THREE.Mesh(new THREE.BoxGeometry(rightW, slabThick, holeW), mat);
      rightMesh.position.set(holeMaxX + rightW / 2, floorY - slabThick / 2, holeZ);
      this.scene.add(rightMesh);
      this.platforms.push({ minX: holeMaxX, maxX, minZ: holeMinZ, maxZ: holeMaxZ, topY: floorY });
    }
  }

  // Builds individual climbable steps and platform colliders for one flight.
  _addFloorStaircase(startX, startZ, baseY, steps, dirX, stairMat) {
    for (let i = 0; i < steps; i++) {
      const stepTopY = baseY + (i + 1) * STEP_H;
      const stepCenterY = baseY + (i + 0.5) * STEP_H;
      const stepX = startX + (i + 0.5) * STEP_D * dirX;

      // Tread
      const tread = new THREE.Mesh(new THREE.BoxGeometry(STEP_D, STEP_H, STAIR_W), stairMat);
      tread.position.set(stepX, stepCenterY, startZ);
      tread.castShadow = true;
      this.scene.add(tread);

      // Platform walkable surface collider
      this.platforms.push({
        minX: stepX - STEP_D / 2,
        maxX: stepX + STEP_D / 2,
        minZ: startZ - STAIR_W / 2,
        maxZ: startZ + STAIR_W / 2,
        topY: stepTopY
      });
    }
  }

  // Add a wall mesh. axis 'x' means the wall runs along X (length along X).
  _addWall(cx, cz, length, height, thick, mat, axis, yOffset = 0) {
    const geo = axis === 'x'
      ? new THREE.BoxGeometry(length, height, thick)
      : new THREE.BoxGeometry(thick, height, length);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, height / 2 + yOffset, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // Add a wall collider (blocks movement).
  _addWallCollider(cx, cz, length, height, axis) {
    if (length <= 0) return;
    if (axis === 'x') {
      this.obstacles.push({ minX: cx - length / 2, maxX: cx + length / 2, minZ: cz - CONFIG.building.wallThick / 2, maxZ: cz + CONFIG.building.wallThick / 2, height, wall: true });
    } else {
      this.obstacles.push({ minX: cx - CONFIG.building.wallThick / 2, maxX: cx + CONFIG.building.wallThick / 2, minZ: cz - length / 2, maxZ: cz + length / 2, height, wall: true });
    }
  }

  // Add glowing windows along the walls.
  _addWindows(x, z, w, d, h, windowMat) {
    const wt = CONFIG.building.wallThick;
    const halfW = w / 2;
    const halfD = d / 2;
    const count = CONFIG.building.windowCount;
    const spacing = w / (count + 1);
    for (let i = 1; i <= count; i++) {
      const wx = x - halfW + spacing * i;
      const wy = 2 + Math.random() * (h - 4);
      // Front and back windows
      const winF = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.1), windowMat);
      winF.position.set(wx, wy, z + halfD + 0.05);
      this.scene.add(winF);
      const winB = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.1), windowMat);
      winB.position.set(wx, wy, z - halfD - 0.05);
      this.scene.add(winB);
    }
    // Side windows
    const spacingZ = d / (count + 1);
    for (let i = 1; i <= count; i++) {
      const wz = z - halfD + spacingZ * i;
      const wy = 2 + Math.random() * (h - 4);
      const winL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.2), windowMat);
      winL.position.set(x - halfW - 0.05, wy, wz);
      this.scene.add(winL);
      const winR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.2), windowMat);
      winR.position.set(x + halfW + 0.05, wy, wz);
      this.scene.add(winR);
    }
  }

  _buildCrates() {
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.8 });
    const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    let placed = 0;
    let attempts = 0;
    while (placed < CONFIG.crateCount && attempts < 300) {
      attempts++;
      const x = (Math.random() * 2 - 1) * (WORLD_HALF - 10);
      const z = (Math.random() * 2 - 1) * (WORLD_HALF - 10);
      if (this._collides(x, z, 1.0)) continue;
      const mesh = new THREE.Mesh(crateGeo, crateMat);
      mesh.position.set(x, 0.8, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.crates.push({ mesh, alive: true, hp: 3 });
      this.obstacles.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 0.8, maxZ: z + 0.8, height: 1.6, crate: mesh });
      placed++;
    }
  }

  // Low concrete barriers / walls — good cover for bots and players.
  _buildBarriers() {
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.9 });
    let placed = 0;
    let attempts = 0;
    while (placed < CONFIG.barrierCount && attempts < 400) {
      attempts++;
      const w = 3 + Math.random() * 4;
      const h = 1.2;
      const d = 0.5;
      const x = (Math.random() * 2 - 1) * (WORLD_HALF - 12);
      const z = (Math.random() * 2 - 1) * (WORLD_HALF - 12);
      if (this._collides(x, z, 1.2)) continue;
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, barrierMat);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h, barrier: mesh });
      placed++;
    }
  }

  // Return a list of cover points (positions near obstacles) for bots to use.
  getCoverPoints() {
    const points = [];
    for (const o of this.obstacles) {
      if (o.crate) continue; // crates are destructible, less reliable
      const cx = (o.minX + o.maxX) / 2;
      const cz = (o.minZ + o.maxZ) / 2;
      // Points on each side of the obstacle
      points.push(new THREE.Vector3(cx, 0, o.minZ - 1.5));
      points.push(new THREE.Vector3(cx, 0, o.maxZ + 1.5));
      points.push(new THREE.Vector3(o.minX - 1.5, 0, cz));
      points.push(new THREE.Vector3(o.maxX + 1.5, 0, cz));
    }
    return points;
  }

  // Find a waypoint (door) to reach a target if the direct path is blocked.
  // Returns a Vector3 waypoint, or null if the direct path is clear.
  findPathTo(from, to) {
    if (this.hasLineOfSight(from, to)) return null;
    // Find the nearest door that helps reach the target
    let best = null;
    let bestScore = Infinity;
    for (const door of this.doors) {
      const doorPos = new THREE.Vector3(door.x, 0, door.z);
      const distToBot = doorPos.distanceTo(from);
      const distToTarget = doorPos.distanceTo(to);
      const score = distToBot + distToTarget;
      if (score < bestScore) {
        bestScore = score;
        best = doorPos;
      }
    }
    return best;
  }

  _buildSky() {
    // Sky dome
    const skyGeo = new THREE.SphereGeometry(400, 24, 16);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x0a1a2f, side: THREE.BackSide, fog: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    // Sun disc
    const sunGeo = new THREE.SphereGeometry(20, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, fog: false });
    this.sunDisc = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunDisc);

    // Fog
    this.scene.fog = new THREE.Fog(0x0a1a2f, 60, 260);
  }

  _buildRain() {
    const count = 1500;
    this.rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * WORLD_HALF * 2;
      positions[i * 3 + 1] = Math.random() * 60;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * WORLD_HALF * 2;
    }
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainMat = new THREE.PointsMaterial({
      color: 0x88bbff,
      size: 0.15,
      transparent: true,
      opacity: 0.5,
    });
    this.rainParticles = new THREE.Points(this.rainGeo, this.rainMat);
    this.rainParticles.visible = false;
    this.scene.add(this.rainParticles);
  }

  setRaining(on) {
    this.isRaining = on;
    if (this.rainParticles) this.rainParticles.visible = on;
    if (this.scene.fog) {
      this.scene.fog.near = on ? 40 : 60;
      this.scene.fog.far = on ? 160 : 260;
    }
  }

  // Returns true if a circle at (x,z) with radius r collides with an obstacle.
  collides(x, z, r) {
    return this._collides(x, z, r);
  }

  _collides(x, z, r) {
    for (const o of this.obstacles) {
      if (x + r > o.minX && x - r < o.maxX && z + r > o.minZ && z - r < o.maxZ) return true;
    }
    // Keep inside world bounds
    if (Math.abs(x) > WORLD_HALF - r || Math.abs(z) > WORLD_HALF - r) return true;
    return false;
  }

  // Resolve a position against obstacles (simple push-out).
  // Walls only block if the player's feet are below the wall height.
  resolveCollision(pos, radius) {
    const feetY = pos.y - CONFIG.player.height;
    for (const o of this.obstacles) {
      if (pos.x + radius > o.minX && pos.x - radius < o.maxX &&
          pos.z + radius > o.minZ && pos.z - radius < o.maxZ) {
        // If the player is above the wall (on a roof/platform), don't block
        if (feetY >= o.height) continue;
        // Push out along the smallest penetration axis
        const dx1 = pos.x - o.minX;
        const dx2 = o.maxX - pos.x;
        const dz1 = pos.z - o.minZ;
        const dz2 = o.maxZ - pos.z;
        const min = Math.min(dx1, dx2, dz1, dz2);
        if (min === dx1) pos.x = o.minX - radius;
        else if (min === dx2) pos.x = o.maxX + radius;
        else if (min === dz1) pos.z = o.minZ - radius;
        else pos.z = o.maxZ + radius;
      }
    }
    pos.x = Math.max(-WORLD_HALF + radius, Math.min(WORLD_HALF - radius, pos.x));
    pos.z = Math.max(-WORLD_HALF + radius, Math.min(WORLD_HALF - radius, pos.z));
  }

  // Get the ground height at a position (0 for ground, or platform top).
  // Only returns platforms the player can step onto from their current height.
  getGroundHeight(x, z, currentFeetY = 0) {
    let groundY = 0;
    const step = CONFIG.building.stepHeight;
    const eps = 0.1; // tolerance for gravity pulling feet slightly below ground
    for (const p of this.platforms) {
      if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) {
        // Only step onto platforms that are within stepHeight of current height
        if (p.topY <= currentFeetY + step + eps && p.topY > groundY) {
          groundY = p.topY;
        }
      }
    }
    return groundY;
  }

  // Check if there's a clear line of sight between two points (at chest height).
  // Returns true if no obstacle blocks the path.
  hasLineOfSight(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return true;
    // Height-aware: if the target is standing on a roof/platform, ground-level
    // walls still block LOS. Sample the ray at chest height and check whether
    // any obstacle wall rises above the line between the two points.
    const fromY = from.y + 1.5; // bot chest
    const toY = to.y + 1.5;     // player chest
    const steps = Math.ceil(dist / 0.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = from.x + dx * t;
      const pz = from.z + dz * t;
      const rayY = fromY + (toY - fromY) * t;
      for (const o of this.obstacles) {
        if (o.crate) continue; // crates are low, don't block LOS at chest height
        if (px > o.minX && px < o.maxX && pz > o.minZ && pz < o.maxZ) {
          // Wall blocks only if it rises above the sight line at this point.
          if (o.height > rayY) return false;
        }
      }
    }
    return true;
  }

  // Damage a crate at position; returns true if it was destroyed.
  damageCrateAt(pos, effects) {
    for (const c of this.crates) {
      if (!c.alive) continue;
      const dx = c.mesh.position.x - pos.x;
      const dz = c.mesh.position.z - pos.z;
      if (Math.abs(dx) < 1.2 && Math.abs(dz) < 1.2) {
        c.hp--;
        if (c.hp <= 0) {
          c.alive = false;
          this.scene.remove(c.mesh);
          effects.explosion(c.mesh.position.clone(), 'debris', 20, 6);
          // remove from obstacles
          const idx = this.obstacles.findIndex((o) => o.crate === c.mesh);
          if (idx >= 0) this.obstacles.splice(idx, 1);
          return true;
        }
        return false;
      }
    }
    return false;
  }

  // Day-night cycle: returns current hour (0-24).
  update(dt) {
    const cycle = CONFIG.dayNight.cycleMinutes * 60;
    const hoursPerSec = 24 / cycle;
    this.hour = (CONFIG.dayNight.startHour + this.clock.getElapsedTime() * hoursPerSec) % 24;

    // Spotlight behavior: if a bot is revealed, lock onto it; otherwise sweep.
    if (this.spotTarget && this.spotTarget.alive && this.spotTarget.revealed > 0) {
      // Lock the spotlight onto the revealed bot.
      this.sun.target.position.copy(this.spotTarget.pos);
      this.spotLockTimer = this.spotTarget.revealed;
    } else {
      // No target — resume random sweeping.
      this.spotTarget = null;
      this.spotAngle += CONFIG.spotlight.sweepSpeed * dt;
      const sweepX = Math.cos(this.spotAngle) * 40;
      const sweepZ = Math.sin(this.spotAngle) * 40;
      this.sun.target.position.set(sweepX, 0, sweepZ);
    }
    this.sun.position.set(this.sun.target.position.x, 60, this.sun.target.position.z);
    this.sun.target.updateMatrixWorld();

    // Sun disc follows the spotlight position (high in the sky).
    this.sunDisc.position.set(this.sun.target.position.x, 60, this.sun.target.position.z);

    // Day/night intensity — keep a bright floor so it's never too dark (Duke Nukem style)
    const angle = ((this.hour - 6) / 24) * Math.PI * 2;
    const dayFactor = Math.max(0, Math.sin(angle));
    const nightFactor = 1 - dayFactor;
    this.hemi.intensity = 0.7 + dayFactor * 0.5;
    this.sun.intensity = 0.6 + dayFactor * 1.2;
    if (this.fill) this.fill.intensity = 0.4 + nightFactor * 0.3;

    // Sky color blend — keep night sky a bit lighter
    const dayColor = new THREE.Color(0x4a90d9);
    const nightColor = new THREE.Color(0x1a2a44);
    const duskColor = new THREE.Color(0x3a2a4a);
    let skyColor;
    if (dayFactor > 0.15) {
      skyColor = dayColor.clone().lerp(nightColor, 1 - dayFactor);
    } else {
      skyColor = duskColor.clone().lerp(nightColor, 1 - dayFactor * 6);
    }
    this.sky.material.color.copy(skyColor);
    if (this.scene.fog) this.scene.fog.color.copy(skyColor);

    // Rain particles fall
    if (this.isRaining && this.rainParticles) {
      const pos = this.rainParticles.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3 + 1] -= 30 * dt;
        if (pos.array[i * 3 + 1] < 0) pos.array[i * 3 + 1] = 60;
      }
      pos.needsUpdate = true;
    }
  }

  // Lock the spotlight onto a revealed bot (or clear it).
  revealBot(bot) {
    this.spotTarget = bot || null;
  }

  dispose() {
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}
