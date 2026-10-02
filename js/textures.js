// Procedural canvas texture generators — no external image files.
// Synthesizes fabric weaves, normal maps, asphalt roughness, and puddles
// entirely in memory at startup.

import * as THREE from 'three';

// Woven fabric / denim texture with cross-stitch thread simulation.
// baseHex: clothing color, noiseScale: grain intensity.
export function generateFabricTexture(baseHex, noiseScale = 16) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Cross-stitch thread simulation: alternating weave pattern.
      const weave = ((x % 2 === 0) ^ (y % 2 === 0)) ? 10 : -10;
      const grain = (Math.random() - 0.5) * noiseScale;
      const delta = weave + grain;

      data[idx] = Math.min(255, Math.max(0, data[idx] + delta));
      data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1] + delta));
      data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + delta));
    }
  }

  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

// Procedural normal map for seams & creases (RGB perturbation).
export function generateNormalMap(scale = 22) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let i = 0; i < img.data.length; i += 4) {
    const nx = 128 + Math.floor((Math.random() - 0.5) * scale);
    const ny = 128 + Math.floor((Math.random() - 0.5) * scale);
    img.data[i] = nx;      // R (X vector)
    img.data[i + 1] = ny;  // G (Y vector)
    img.data[i + 2] = 255; // B (Z pointing outward)
    img.data[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

// Wet asphalt roughness map: dry concrete (light) with dark puddle blobs.
// Used as a roughnessMap — dark zones = wet = low roughness = shiny.
export function generateAsphaltRoughnessMap() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base dry asphalt (mid-grey in roughness map = mid roughness).
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Grainy asphalt texture.
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const g = 128 + (Math.random() - 0.5) * 30;
    data[i] = g;
    data[i + 1] = g;
    data[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);

  // Puddle blobs: dark (low roughness = wet = reflective).
  const puddleCount = 14;
  for (let p = 0; p < puddleCount; p++) {
    const px = Math.random() * size;
    const py = Math.random() * size;
    const pr = 12 + Math.random() * 30;
    const grad = ctx.createRadialGradient(px, py, 2, px, py, pr);
    grad.addColorStop(0, 'rgba(20, 20, 25, 0.9)');
    grad.addColorStop(0.7, 'rgba(30, 30, 35, 0.5)');
    grad.addColorStop(1, 'rgba(128, 128, 128, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

// Brick / concrete relief normal map for interior walls.
export function generateBrickNormalMap() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const brickH = 16; // brick height in px
  const mortar = 3;  // mortar thickness

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const row = Math.floor(y / brickH);
      const offset = (row % 2) * (brickH / 2); // running bond offset
      const inMortarY = (y % brickH) < mortar;
      const inMortarX = ((x + offset) % (brickH * 2)) < mortar;

      let nx = 128, ny = 128;
      if (inMortarY || inMortarX) {
        // Mortar recess: normal tilts inward.
        nx = 128 + (Math.random() - 0.5) * 10;
        ny = 128 + (Math.random() - 0.5) * 10;
      } else {
        // Brick face: subtle grain.
        nx = 128 + (Math.random() - 0.5) * 16;
        ny = 128 + (Math.random() - 0.5) * 16;
      }
      data[idx] = nx;
      data[idx + 1] = ny;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}