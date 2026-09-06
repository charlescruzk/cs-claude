import * as THREE from 'three';

// Procedural canvas textures, one per surface kind. No external assets: each is a
// 128×128 canvas filled with a base tint, scattered noise, and a few seam lines,
// with RepeatWrapping so it tiles across large faces. Cached by kind so a whole wall
// and its neighbours share one texture (and one GPU upload).
const BASE = {
  sand:     '#c2a86a',
  concrete: '#7c7c82',
  crate:    '#8a6a3a',
  floor:    '#6b6b6b',
};

const cache = new Map();

// Lighten (v>0) or darken (v<0) a "#rrggbb" base by `v` per channel, clamped.
function shade(hex, v) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + v);
  const g = clamp(((n >> 8) & 0xff) + v);
  const b = clamp((n & 0xff) + v);
  return `rgb(${r},${g},${b})`;
}

function clamp(c) {
  return Math.max(0, Math.min(255, c)) | 0;
}

export function makeTexture(kind) {
  if (cache.has(kind)) return cache.get(kind);

  const size = 128;
  const base = BASE[kind] || '#888888';
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

   // 1) base fill
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

   // 2) grain: scattered light/dark pixels
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = shade(base, Math.random() * 70 - 35);
    ctx.fillRect(x | 0, y | 0, 1, 1);
    }

   // 3) a few seam / crack lines so the tiling reads as a surface, not flat color
  ctx.strokeStyle = shade(base, -45);
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * size, 0);
    ctx.lineTo(Math.random() * size, size);
    ctx.stroke();
    }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.needsUpdate = true;
  cache.set(kind, tex);
  return tex;
}
