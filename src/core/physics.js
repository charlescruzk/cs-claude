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
const STEP = 0.6;

// Push `pos` (feet) out of every overlapping collider, resolved X then Z then Y.
// Returns true when the player is standing on a box top.
export function resolveCapsuleVsBoxes(pos, radius, height, colliders, opts = {}) {
  const vy = opts.vy || 0;
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

// Are we standing on a box top, or on the floor plane at y = floorY?
export function groundCheck(pos, radius, height, colliders, floorY = 0) {
  if (pos.y <= floorY + 0.02) return true;
  for (const c of colliders) {
    if (c.max.y > pos.y + 0.05 || c.max.y < pos.y - 0.05) continue;
    if (
      pos.x + radius > c.min.x && pos.x - radius < c.max.x &&
      pos.z + radius > c.min.z && pos.z - radius < c.max.z
     ) {
      return true;
     }
   }
  return false;
}

// Ray-vs-AABB slab test. Returns the entry distance in [0, maxT], or null on a miss.
// `dir` must be normalized.
export function rayAABB(origin, dir, min, max, maxT = Infinity) {
  let tmin = 0;
  let tmax = maxT;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
       // Parallel to this axis: a hit is only possible if the origin is in slab.
      if (o < min[axis] || o > max[axis]) return null;
     } else {
      const inv = 1 / d;
      let t1 = (min[axis] - o) * inv;
      let t2 = (max[axis] - o) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
     }
   }
  return tmin;
}
