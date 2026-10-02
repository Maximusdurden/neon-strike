// Procedural neon city: terrain, streets, buildings, crates, sky, weather, day-night.

import * as THREE from 'three';
import { CONFIG, WORLD_HALF } from './config.js?v=20261002c';
import { generateAsphaltRoughnessMap, generateBrickNormalMap } from './textures.js?v=20261002c';

// --- Building / stair generation constants ---
const FLOOR_HEIGHT = 3.5;   // meters per story
const STEP_H = 0.25;        // stair riser height
const STEP_D = 0.35;        // stair tread depth (along travel axis)
const STAIR_W = 1.4;        // stair width (across travel axis)

// Deterministic PRNG (mulberry32) so host + client generate IDENTICAL maps.
// Multiplayer needs the same world on both sides — the host picks a seed and
// sends it in the init packet; the client rebuilds with the same seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(scene, seed = null) {
    this.scene = scene;
    this.buildings = [];
    this.crates = [];
    this.obstacles = []; // colliders: { minX, maxX, minZ, maxZ, height }
    this.platforms = []; // walkable surfaces: { minX, maxX, minZ, maxZ, topY }
    this.doors = [];     // door openings: { x, z }
    this.fuseBoxes = []; // interactive breaker boxes: { mesh, pos, building, cut, timer }
    this.cars = [];      // parked cars: { mesh, pos, alarmed, timer }
    this.trashCans = []; // metallic dumpsters: { mesh, pos, alarmed, timer }
    this.clock = new THREE.Clock();
    this.rainParticles = null;
    this.rainGeo = null;
    this.rainMat = null;
    this.isRaining = false;
    this.hour = CONFIG.dayNight.startHour;
    this.built = false;

    // Stadium floodlights (OFF by default) + central circuit breaker.
    this.stadiumLightsActive = false;
    this.stadiumPylons = [];   // { mesh, light, pos }
    this.breaker = null;       // { mesh, pos, active }
    this.breakerHold = 0;      // seconds the player has held E at the breaker

    // Seeded RNG: if a seed is provided, ALL procedural placement uses it so
    // two clients build the same city. Solo play uses Math.random (unseeded).
    this.seed = seed;
    this.rng = seed !== null && seed !== undefined ? mulberry32(seed) : null;
    this._rand = this.rng || Math.random;
  }

  // Build the city. Called lazily so multiplayer can seed the world BEFORE any
  // geometry is created — the host picks a seed, the client rebuilds with it.
  build(seed = null) {
    if (seed !== null && seed !== undefined) {
      this.seed = seed;
      this.rng = mulberry32(seed);
      this._rand = this.rng;
    }
    this._buildLights();
    this._buildGround();
    this._buildCity();
    this._buildCrates();
    this._buildBarriers();
    this._buildCars();
    this._buildTrashCans();
    this._buildStadium();
    this._buildSky();
    this._buildRain();
    this._buildReflection();
    this.built = true;
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
    // Wet asphalt with puddle roughness map: dry concrete stays matte, puddle
    // zones go glossy and reflect the sweeping spotlight. Charcoal base.
    this.groundMat = new THREE.MeshStandardMaterial({
      color: 0x1c1e22,
      metalness: 0.15,
      roughness: 0.82,
      roughnessMap: generateAsphaltRoughnessMap(),
    });
    const ground = new THREE.Mesh(geo, this.groundMat);
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
    // Desaturated cinematic palette: weathered brick / dark stucco exteriors
    // with warm tungsten or soft fluorescent window accents.
    const styles = [
      { wall: 0x23262d, floor: 0x2a2d33, accent: 0xffb86c }, // charcoal + tungsten
      { wall: 0x2b2622, floor: 0x332d28, accent: 0x8be9fd }, // dark stucco + soft fluoro
      { wall: 0x262a26, floor: 0x2d332d, accent: 0xffb86c }, // moss + tungsten
      { wall: 0x2a262b, floor: 0x332d33, accent: 0x8be9fd }, // plum + fluoro
      { wall: 0x24262a, floor: 0x2b2e33, accent: 0xffb86c }, // slate + tungsten
      { wall: 0x2c2c2c, floor: 0x343434, accent: 0x8be9fd }, // grey + fluoro
    ];
    while (placed.length < CONFIG.buildingCount && attempts < 500) {
      attempts++;
      // Vary footprint: some small, some large, some tall towers.
      const w = 8 + this._rand() * 12;
      const d = 8 + this._rand() * 12;
      const x = (this._rand() * 2 - 1) * (WORLD_HALF - 16);
      const z = (this._rand() * 2 - 1) * (WORLD_HALF - 16);
      const h = CONFIG.buildingMinH + this._rand() * (CONFIG.buildingMaxH - CONFIG.buildingMinH);
      const style = styles[Math.floor(this._rand() * styles.length)];

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
    const wallColor = style.wall || 0x23262d;
    const floorColor = style.floor || 0x2a2d33;
    const accentColor = style.accent || 0xffb86c;
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor,
      roughness: 0.85,
      metalness: 0.1,
      normalMap: generateBrickNormalMap(),
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.9 });
    const windowMat = new THREE.MeshBasicMaterial({ color: accentColor });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6 });
    const stairMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.9 });

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

    // Stairwell placement (anchored flush against the back interior wall so
    // there's no gap between the wall and the first step to fall through).
    // The wall collider inner face is at z - halfD + wt/2, so the stairs start
    // exactly there — no gap.
    const stairSteps = Math.round(FLOOR_HEIGHT / STEP_H);
    const stairRunLength = stairSteps * STEP_D;
    const stairZ = z - halfD + wt / 2 + STAIR_W / 2;

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

    // Interior volumetric light shafts — faint cones below windows/doorways
    // that break up flat interior lighting and give stealth hiding pools.
    this._addLightShafts(x, z, w, d, actualH, accentColor);

    // Fuse box on the ground floor (interactive breaker — cuts interior lights).
    // Placed on an interior wall near the door, at waist height.
    if (this.fuseBoxes.length < CONFIG.env.fuseBoxCount) {
      const fbX = x + (this._rand() < 0.5 ? -1 : 1) * (halfW * 0.5);
      const fbZ = z + halfD - wt - 0.4;
      const fbMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.7, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x2a2a3a, metalness: 0.6, roughness: 0.4 })
      );
      fbMesh.position.set(fbX, 1.3, fbZ);
      fbMesh.castShadow = true;
      this.scene.add(fbMesh);
      // Glowing indicator light (green = powered, red = cut)
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x3bff8a })
      );
      light.position.set(0, 0.2, 0.08);
      fbMesh.add(light);
      this.fuseBoxes.push({
        mesh: fbMesh,
        light,
        pos: new THREE.Vector3(fbX, 1.3, fbZ),
        building: this.buildings[this.buildings.length - 1],
        cut: false,
        timer: 0,
      });
    }
  }

  // Generates a floor slab divided into sections around a stairwell cutout.
  _addFloorSlabWithHole(cx, cz, fw, fd, floorY, holeX, holeZ, holeLen, holeW, dir, mat) {
    const slabThick = 0.25;
    // The hole matches the stairs EXACTLY (tiny epsilon only to avoid z-fighting).
    // Previously a 0.2m margin left a gap at the top of the stairs where the
    // player fell through between the last step and the floor slab.
    const holeMinX = Math.min(holeX, holeX + dir * holeLen) - 0.05;
    const holeMaxX = Math.max(holeX, holeX + dir * holeLen) + 0.05;
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

  // Builds individual climbable steps with solid vertical risers underneath each step
  _addFloorStaircase(startX, startZ, baseY, steps, dirX, stairMat) {
    for (let i = 0; i < steps; i++) {
      const stepTopY = baseY + (i + 1) * STEP_H;
      const stepCenterY = baseY + (i + 0.5) * STEP_H;
      const stepX = startX + (i + 0.5) * STEP_D * dirX;

      // 1. Walkable Step Tread
      const tread = new THREE.Mesh(new THREE.BoxGeometry(STEP_D, STEP_H, STAIR_W), stairMat);
      tread.position.set(stepX, stepCenterY, startZ);
      tread.castShadow = true;
      this.scene.add(tread);

      // 2. Solid Underside Infill (Only directly below this step down to floor level)
      const underHeight = i * STEP_H;
      if (underHeight > 0.05) {
        const underMesh = new THREE.Mesh(
          new THREE.BoxGeometry(STEP_D, underHeight, STAIR_W),
          stairMat
        );
        underMesh.position.set(stepX, baseY + underHeight / 2, startZ);
        underMesh.castShadow = true;
        this.scene.add(underMesh);
      }

      // 3. Walkable Platform Registration
      this.platforms.push({
        minX: stepX - STEP_D / 2,
        maxX: stepX + STEP_D / 2,
        minZ: startZ - STAIR_W / 2,
        maxZ: startZ + STAIR_W / 2,
        topY: stepTopY,
        creak: true,
      });
    }

    // 4. Under-Stair Closet Back Wall (Only blocks entry from the tall back end)
    // Placed at the high end of the flight so players can't walk into the 1.8m+ cavity behind the stairs
    const backWallX = startX + steps * STEP_D * dirX;
    this.obstacles.push({
      minX: backWallX - 0.2,
      maxX: backWallX + 0.2,
      minZ: startZ - STAIR_W / 2,
      maxZ: startZ + STAIR_W / 2,
      height: baseY + steps * STEP_H,
      wall: true,
    });
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

  // Faint volumetric light shafts below windows/doorways — semi-transparent
  // cones that give interiors distinct light/shadow pools for stealth hiding.
  _addLightShafts(x, z, w, d, h, accentColor) {
    const wt = CONFIG.building.wallThick;
    const halfW = w / 2;
    const halfD = d / 2;
    const shaftMat = new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // One shaft per floor, near a window on the front wall.
    const floors = Math.max(1, Math.floor(h / FLOOR_HEIGHT));
    for (let f = 0; f < floors; f++) {
      const y = f * FLOOR_HEIGHT + 0.5;
      const wx = x + (this._rand() * 2 - 1) * (halfW * 0.6);
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(0.9, FLOOR_HEIGHT * 0.9, 8, 1, true), shaftMat);
      shaft.position.set(wx, y + FLOOR_HEIGHT * 0.45, z + halfD - wt - 0.5);
      shaft.rotation.x = Math.PI; // point down
      this.scene.add(shaft);
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
      const wy = 2 + this._rand() * (h - 4);
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
      const wy = 2 + this._rand() * (h - 4);
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
      const x = (this._rand() * 2 - 1) * (WORLD_HALF - 10);
      const z = (this._rand() * 2 - 1) * (WORLD_HALF - 10);
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
      const w = 3 + this._rand() * 4;
      const h = 1.2;
      const d = 0.5;
      const x = (this._rand() * 2 - 1) * (WORLD_HALF - 12);
      const z = (this._rand() * 2 - 1) * (WORLD_HALF - 12);
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

  // Parked cars — striking them triggers a loud alarm that draws bots.
  _buildCars() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4a6a, metalness: 0.7, roughness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, metalness: 0.5, roughness: 0.5 });
    let placed = 0;
    let attempts = 0;
    while (placed < CONFIG.env.carCount && attempts < 300) {
      attempts++;
      const x = (this._rand() * 2 - 1) * (WORLD_HALF - 14);
      const z = (this._rand() * 2 - 1) * (WORLD_HALF - 14);
      if (this._collides(x, z, 1.6)) continue;
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.4), bodyMat);
      body.position.y = 0.55;
      group.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.2), darkMat);
      cabin.position.set(0, 1.1, -0.2);
      group.add(cabin);
      // Wheels
      const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      for (const [wx, wz] of [[-1.0, 1.4], [1.0, 1.4], [-1.0, -1.4], [1.0, -1.4]]) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(wx, 0.35, wz);
        group.add(wheel);
      }
      group.position.set(x, 0, z);
      group.rotation.y = this._rand() * Math.PI;
      group.castShadow = true;
      this.scene.add(group);
      this.cars.push({ mesh: group, pos: new THREE.Vector3(x, 0, z), alarmed: false, timer: 0 });
      this.obstacles.push({ minX: x - 1.4, maxX: x + 1.4, minZ: z - 2.4, maxZ: z + 2.4, height: 1.4, car: group });
      placed++;
    }
  }

  // Metallic dumpsters in back alleys — kicking them clangs loudly.
  _buildTrashCans() {
    const canMat = new THREE.MeshStandardMaterial({ color: 0x5a5a6a, metalness: 0.8, roughness: 0.4 });
    let placed = 0;
    let attempts = 0;
    while (placed < CONFIG.env.trashCanCount && attempts < 300) {
      attempts++;
      const x = (this._rand() * 2 - 1) * (WORLD_HALF - 12);
      const z = (this._rand() * 2 - 1) * (WORLD_HALF - 12);
      if (this._collides(x, z, 0.8)) continue;
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 1.1, 12), canMat);
      body.position.y = 0.55;
      group.add(body);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 12), canMat);
      lid.position.y = 1.15;
      group.add(lid);
      group.position.set(x, 0, z);
      group.castShadow = true;
      this.scene.add(group);
      this.trashCans.push({ mesh: group, pos: new THREE.Vector3(x, 0, z), alarmed: false, timer: 0 });
      this.obstacles.push({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6, height: 1.2, trash: group });
      placed++;
    }
  }

  // Build the stadium floodlight grid + central circuit breaker substation.
  // 4 industrial light pylons at (X, Z = ±45m), height 28m. Lights are OFF by
  // default (intensity 0.0). The breaker sits in the central plaza at (0,0)
  // and requires a 3.0-second hold (KeyE) to activate.
  _buildStadium() {
    const st = CONFIG.stadium;
    const pylonMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, metalness: 0.7, roughness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfffaed, emissive: 0xfffaed, emissiveIntensity: 0.8 });

    const positions = [
      [st.pylonDistance, st.pylonDistance],
      [st.pylonDistance, -st.pylonDistance],
      [-st.pylonDistance, st.pylonDistance],
      [-st.pylonDistance, -st.pylonDistance],
    ];

    for (const [px, pz] of positions) {
      const group = new THREE.Group();
      // Tower column
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, st.pylonHeight, 8), pylonMat);
      column.position.y = st.pylonHeight / 2;
      group.add(column);
      // Lamp head (facing the arena center)
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.2), lampMat);
      lamp.position.y = st.pylonHeight + 0.4;
      group.add(lamp);
      group.position.set(px, 0, pz);
      group.castShadow = true;
      this.scene.add(group);

      // Floodlight: a spotlight aimed at the arena center. OFF by default.
      const flood = new THREE.SpotLight(0xfffaed, 0.0, 200, Math.PI / 6, 0.5, 1.5);
      flood.position.set(px, st.pylonHeight + 1, pz);
      flood.target.position.set(-px * 0.5, 0, -pz * 0.5);
      flood.castShadow = true;
      this.scene.add(flood);
      this.scene.add(flood.target);

      this.stadiumPylons.push({ group, lamp, flood, pos: new THREE.Vector3(px, 0, pz) });
    }

    // Central circuit breaker substation at (0,0).
    const breakerGroup = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), pylonMat);
    base.position.y = 0.3;
    breakerGroup.add(base);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10), lampMat.clone());
    core.position.y = 0.9;
    breakerGroup.add(core);
    breakerGroup.position.set(st.breakerPos.x, 0, st.breakerPos.z);
    breakerGroup.castShadow = true;
    this.scene.add(breakerGroup);
    this.breaker = {
      mesh: breakerGroup,
      core,
      pos: new THREE.Vector3(st.breakerPos.x, 0, st.breakerPos.z),
      active: false,
    };
  }

  // Toggle the stadium floodlight grid. When ON, the arena floods with
  // high-intensity daylight illumination and stealth concealment drops to zero.
  setStadiumLights(on) {
    this.stadiumLightsActive = on;
    for (const p of this.stadiumPylons) {
      p.flood.intensity = on ? CONFIG.stadium.floodIntensity : 0.0;
      p.lamp.material.emissiveIntensity = on ? 1.2 : 0.8;
    }
    if (this.breaker) {
      this.breaker.active = on;
      this.breaker.core.material.color.setHex(on ? 0x3bff8a : 0xfffaed);
      this.breaker.core.material.emissive.setHex(on ? 0x3bff8a : 0xfffaed);
    }
  }

  // True if the player is standing at the central breaker substation.
  isAtBreaker(pos) {
    if (!this.breaker) return false;
    const dx = pos.x - this.breaker.pos.x;
    const dz = pos.z - this.breaker.pos.z;
    return Math.hypot(dx, dz) < 2.2;
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
      positions[i * 3] = (this._rand() * 2 - 1) * WORLD_HALF * 2;
      positions[i * 3 + 1] = this._rand() * 60;
      positions[i * 3 + 2] = (this._rand() * 2 - 1) * WORLD_HALF * 2;
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

  // Dynamic ground reflection that tracks the sun/spotlight position.
  // Instead of a static blinding mirror, the reflection is a soft pool of
  // light that moves with the sweeping spotlight — so the glare always has a
  // corresponding light source and casts moving highlights across the map.
  _buildReflection() {
    // A large, very soft radial gradient plane that follows the sun's ground
    // position. It reads as "wet asphalt reflecting the spotlight" without
    // the harsh mirror finish.
    const geo = new THREE.PlaneGeometry(60, 60);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 240, 200, 0.55)');
    grad.addColorStop(0.4, 'rgba(255, 230, 180, 0.22)');
    grad.addColorStop(1, 'rgba(255, 230, 180, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    this.reflectionMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.reflection = new THREE.Mesh(geo, this.reflectionMat);
    this.reflection.rotation.x = -Math.PI / 2;
    this.reflection.position.y = 0.03;
    this.reflection.visible = false; // only visible when the sun is up
    this.scene.add(this.reflection);
  }

  // Update the reflection pool to track the sun's ground position.
  _updateReflection() {
    if (!this.reflection) return;
    const angle = ((this.hour - 6) / 24) * Math.PI * 2;
    const dayFactor = Math.max(0, Math.sin(angle));
    // The sun's ground target is where the spotlight points.
    const tx = this.sun.target.position.x;
    const tz = this.sun.target.position.z;
    this.reflection.position.set(tx, 0.03, tz);
    // Fade in/out with daylight; stronger when raining (wet = more glare).
    const wetBoost = this.isRaining ? 1.4 : 1.0;
    this.reflection.visible = dayFactor > 0.1;
    this.reflectionMat.opacity = 0.9 * dayFactor * wetBoost;
  }

  setRaining(on) {
    this.isRaining = on;
    if (this.rainParticles) this.rainParticles.visible = on;
    if (this.scene.fog) {
      this.scene.fog.near = on ? 40 : 60;
      this.scene.fog.far = on ? 160 : 260;
    }
    // Wet asphalt: lerp ground roughness down so neon reflects.
    if (this.groundMat) {
      this.groundMat.roughness = on ? 0.3 : 0.82;
      this.groundMat.metalness = on ? 0.3 : 0.15;
      this.groundMat.needsUpdate = true;
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
  // Strictly ignores any surface that is ABOVE the player's feet by more than
  // stepHeight + 0.05 — this prevents upward snapping through overhead flights
  // (Bug 2: stair clipping & open underside traps).
  getGroundHeight(x, z, currentFeetY = 0) {
    let groundY = 0;
    const step = CONFIG.building.stepHeight;
    const eps = 0.1; // tolerance for gravity pulling feet slightly below ground
    for (const p of this.platforms) {
      if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) {
        // Strict overhead cutoff: never snap up onto a surface more than
        // stepHeight + 0.05 above the current feet position.
        if (p.topY > currentFeetY + step + 0.05) continue;
        // Only step onto platforms that are within stepHeight of current height
        if (p.topY <= currentFeetY + step + eps && p.topY > groundY) {
          groundY = p.topY;
        }
      }
    }
    return groundY;
  }

  // True if the player's feet are on a creaky wooden stair surface.
  isOnCreakSurface(x, z, feetY) {
    const step = CONFIG.building.stepHeight;
    const eps = 0.15;
    for (const p of this.platforms) {
      if (!p.creak) continue;
      if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) {
        if (Math.abs(p.topY - feetY) < step + eps) return true;
      }
    }
    return false;
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

    // Environmental timers (fuse boxes, car alarms, trash cans).
    this.updateEnv(dt);

    // Spotlight behavior: if a bot is revealed, lock onto it; otherwise sweep.
    if (this.spotTarget && this.spotTarget.alive && this.spotTarget.revealed > 0) {
      // Lock the spotlight onto the revealed bot.
      this.sun.target.position.copy(this.spotTarget.pos);
      this.spotLockTimer = this.spotTarget.revealed;
    } else if (this.spotLockPos && this.spotLockTimer > 0) {
      // Lock the spotlight onto a revealed position (e.g. gunfire).
      this.spotLockTimer -= dt;
      this.sun.target.position.copy(this.spotLockPos);
      if (this.spotLockTimer <= 0) this.spotLockPos = null;
    } else {
      // No target — resume random sweeping.
      this.spotTarget = null;
      this.spotLockPos = null;
      this.spotAngle += CONFIG.spotlight.sweepSpeed * dt;
      const sweepX = Math.cos(this.spotAngle) * 40;
      const sweepZ = Math.sin(this.spotAngle) * 40;
      this.sun.target.position.set(sweepX, 0, sweepZ);
    }
    this.sun.position.set(this.sun.target.position.x, 60, this.sun.target.position.z);
    this.sun.target.updateMatrixWorld();

    // Sun disc follows the spotlight position (high in the sky).
    this.sunDisc.position.set(this.sun.target.position.x, 60, this.sun.target.position.z);

    // Reflection pool tracks the sun's ground position (moving glare).
    this._updateReflection();

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

  // True when it's dark enough that infected visors glow visibly.
  // Day factor is sin((hour-6)/24 * 2pi); night is when it drops below 0.35.
  isNight() {
    const angle = ((this.hour - 6) / 24) * Math.PI * 2;
    const dayFactor = Math.max(0, Math.sin(angle));
    return dayFactor < 0.35;
  }

  // Lock the spotlight onto an arbitrary position (e.g. gunfire) for a duration.
  revealPosition(pos, duration) {
    this.spotTarget = null;
    this.spotLockPos = pos ? pos.clone() : null;
    this.spotLockTimer = duration || 0;
  }

  // --- Environmental sabotage & distractions ---

  // Interact with a fuse box near the player. Cuts the building's interior
  // lights for a window, giving an evasion opportunity. Returns true if used.
  interactFuseBox(playerPos) {
    for (const fb of this.fuseBoxes) {
      if (fb.cut) continue;
      if (fb.pos.distanceTo(playerPos) < 2.2) {
        fb.cut = true;
        fb.timer = CONFIG.env.fuseCutDuration;
        fb.light.material.color.setHex(0xff3b3b); // red = power cut
        // Darken the building's interior lights (windows + floor emissive).
        this._setBuildingLights(fb.building, false);
        return true;
      }
    }
    return false;
  }

  // Trigger a car alarm near the player. Returns true if a car was alarmed.
  triggerCarAlarm(playerPos) {
    for (const car of this.cars) {
      if (car.alarmed) continue;
      if (car.pos.distanceTo(playerPos) < 2.5) {
        car.alarmed = true;
        car.timer = CONFIG.env.alarmDuration;
        return true;
      }
    }
    return false;
  }

  // Kick a trash can near the player. Returns true if one was kicked.
  triggerTrashCan(playerPos) {
    for (const can of this.trashCans) {
      if (can.alarmed) continue;
      if (can.pos.distanceTo(playerPos) < 2.0) {
        can.alarmed = true;
        can.timer = CONFIG.env.alarmDuration;
        return true;
      }
    }
    return false;
  }

  // Darken / restore a building's interior lights (windows + floor).
  _setBuildingLights(building, on) {
    if (!building) return;
    // Windows are MeshBasicMaterial with accent colors — dim them.
    const dim = on ? 1 : 0.15;
    this.scene.traverse((obj) => {
      if (obj.material && obj.material.isMeshBasicMaterial && obj.material.color) {
        // Only touch window-like emissive planes near this building.
        const dx = obj.position.x - building.x;
        const dz = obj.position.z - building.z;
        if (Math.abs(dx) < building.w / 2 + 1 && Math.abs(dz) < building.d / 2 + 1) {
          if (obj.geometry && obj.geometry.type === 'PlaneGeometry') {
            obj.material.color.multiplyScalar(on ? 1 / dim : dim);
          }
        }
      }
    });
  }

  // Update fuse box timers, car alarms, trash can timers.
  updateEnv(dt) {
    for (const fb of this.fuseBoxes) {
      if (fb.cut) {
        fb.timer -= dt;
        if (fb.timer <= 0) {
          fb.cut = false;
          fb.light.material.color.setHex(0x3bff8a); // green = powered
          this._setBuildingLights(fb.building, true);
        }
      }
    }
    for (const car of this.cars) {
      if (car.alarmed) {
        car.timer -= dt;
        if (car.timer <= 0) car.alarmed = false;
      }
    }
    for (const can of this.trashCans) {
      if (can.alarmed) {
        can.timer -= dt;
        if (can.timer <= 0) can.alarmed = false;
      }
    }
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
