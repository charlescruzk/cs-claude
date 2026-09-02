import { events } from '../core/events.js';

// Ray-vs-AABB slab test. Returns the entry distance t (≥ 0) or null when the ray
// misses `box`. `origin` and `dir` are world-space; dir must be normalized.
function rayAABB(origin, dir, min, max) {
   let tmin = 0;
   let tmax = Infinity;
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

// Resolve one shot against the map and any hittable targets. `targets` is an
// array of { box, headBox, onHit(damage, headshot) }; `weapon` supplies the base
// damage. Returns the nearest hit { kind, t, target?, headshot? } or null. A
// nearer wall shadows a bot behind it, so a crate blocks the shot. Emits 'hit'.
export function resolveShot(origin, dir, colliders, targets, weapon) {
   let nearestT = Infinity;
   let result = null;

     // Walls (map colliders).
   for (const c of colliders) {
     const t = rayAABB(origin, dir, c.min, c.max);
     if (t !== null && t < nearestT) {
       nearestT = t;
       result = { kind: 'wall', t };
      }
     }

     // Targets: nearest of the body and head box on each bot.
   for (const target of targets) {
     if (target.dead) continue;
     const tb = rayAABB(origin, dir, target.box.min, target.box.max);
     const th = target.headBox ? rayAABB(origin, dir, target.headBox.min, target.headBox.max) : null;
      let tt = tb;
      let headshot = false;
      if (th !== null) {
        if (tt === null || th < tt) {
          tt = th;
          headshot = true;
          }
       }
     if (tt !== null && tt < nearestT) {
       nearestT = tt;
       result = { kind: 'target', t: tt, target, headshot };
       }
     }

    if (!result) return null;
    if (result.kind === 'wall') return result;

      // A bot was the nearest hit: apply damage (4x on the head) and report it.
    const damage = weapon.damage * (result.headshot ? 4 : 1);
    result.target.onHit(damage, result.headshot);
    events.emit('hit', { target: result.target, damage, headshot: result.headshot });
    return result;
   }
