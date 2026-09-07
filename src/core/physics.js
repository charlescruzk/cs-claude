import * as THREE from 'three';

// Colliders are axis-aligned boxes { min: Vector3, max: Vector3 }. No physics
// library: everything here is hand-rolled AABB math, resolved one axis at a time
// so the player slides along walls instead of sticking.

export function aabbOverlap(a, b) {
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
   );
}

// Scratch box reused across calls (resolution is synchronous, so this is safe).
const _p = { min: new THREE.Vector3(), max: new THREE.Vector3() };

function playerBox(pos, radius, height, out) {
  out.min.set(pos.x - radius, pos.y, pos.z - radius);
  out.max.set(pos.x + radius, pos.y + height, pos.z + radius);
  return out;
}

// A box whose top is within STEP of the feet is not a horizontal obstacle: the
// player walks or jumps over it instead of being blocked. This is what lets a
// 1 m crate be jumped onto (peak jump ~1.3 m) while a 2 m wall still blocks.
export const STEP = 0.6;

// Push `pos` (feet) out of every overlapping collider, resolved X then Z then Y.
// Returns true when the player is standing on a box top.
export function resolveCapsuleVsBoxes(pos, radius, height, colliders, opts = {}) {
  let grounded = false;

    // --- horizontal: resolve each overlap along its axis of least penetration ---
  for (const c of colliders) {
    const b = playerBox(pos, radius, height, _p);
    if (!aabbOverlap(b, c)) continue;
    if (c.max.y - pos.y <= STEP) continue; // low enough to step/jump over

    const left = pos.x + radius - c.min.x;   // push toward -x
    const right = c.max.x - (pos.x - radius); // push toward +x
    const back = pos.z + radius - c.min.z;   // push toward -z
    const fwd = c.max.z - (pos.z - radius);  // push toward +z

    const pushX = left < right ? -left : right;
    const pushZ = back < fwd ? -back : fwd;
    if (Math.abs(pushX) <= Math.abs(pushZ)) pos.x += pushX;
    else pos.z += pushZ;
    }

    // --- Y ---
  for (const c of colliders) {
    const b = playerBox(pos, radius, height, _p);
    if (!aabbOverlap(b, c)) continue;
    const up = c.max.y - pos.y;             // land on top
    const down = pos.y + height - c.min.y;  // bonk head
    if (up < down) {
      pos.y += up;
      grounded = true;
     } else {
      pos.y -= down;
     }
     }

  return grounded;
}

// rayAABB(origin, dir, min, max, maxT = Infinity, outHit = null) -> number | null
// Returns the entry distance as before. When `outHit` is supplied it is filled with
// { axis: 0|1|2, sign: -1|1 } describing the face that was crossed, so the caller can
// build a surface normal without a second test. Pass a module-level scratch object;
// do not allocate one per call. `dir` must be normalized.
export function rayAABB(origin, dir, min, max, maxT = Infinity, outHit = null) {
  let tmin = 0;
  let tmax = maxT;
  let hitAxis = -1; // -1: ray started inside the box, no face crossed
  let hitSign = 0;

  // --- x slab ---
  const ox = origin.x;
  const dx = dir.x;
  if (Math.abs(dx) < 1e-8) {
    // Parallel to this axis: a hit is only possible if the origin is in slab.
    if (ox < min.x || ox > max.x) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (min.x - ox) * inv;
    let t2 = (max.x - ox) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) { tmin = t1; hitAxis = 0; hitSign = dx > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // --- y slab ---
  const oy = origin.y;
  const dy = dir.y;
  if (Math.abs(dy) < 1e-8) {
    if (oy < min.y || oy > max.y) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (min.y - oy) * inv;
    let t2 = (max.y - oy) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) { tmin = t1; hitAxis = 1; hitSign = dy > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // --- z slab ---
  const oz = origin.z;
  const dz = dir.z;
  if (Math.abs(dz) < 1e-8) {
    if (oz < min.z || oz > max.z) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (min.z - oz) * inv;
    let t2 = (max.z - oz) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) { tmin = t1; hitAxis = 2; hitSign = dz > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (outHit) {
    outHit.axis = hitAxis;
    outHit.sign = hitSign;
  }
  return tmin;
}
