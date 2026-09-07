import { events } from '../core/events.js';
import { rayAABB } from '../core/physics.js';

// Scratch result reused across calls — the returned object is mutated in place
// as the nearest hit improves, so a caller must copy anything it wants to keep.
// Safe because main.js discards the return value and no other caller stores it.
const _result = { kind: 'wall', t: 0, target: null, headshot: false };

// Resolve one shot against the map and any hittable targets. `targets` is an
// array of { box, headBox, onHit(damage, headshot, weapon) }; `weapon` supplies the
// base damage and is threaded to the target so its 'kill' event carries the weapon.
// Returns the nearest hit { kind, t, target?, headshot? } or null. A
// nearer wall shadows a bot behind it, so a crate blocks the shot. Emits 'hit'
// only for targets whose onHit does not emit it themselves (remote players).
export function resolveShot(origin, dir, colliders, targets, weapon) {
   let nearestT = Infinity;
   let result = null;

     // Walls (map colliders).
   for (const c of colliders) {
     const t = rayAABB(origin, dir, c.min, c.max);
     if (t !== null && t < nearestT) {
       nearestT = t;
       _result.kind = 'wall';
       _result.t = t;
       // Clear the target fields: the scratch object is reused, so a wall hit would
       // otherwise carry a stale bot reference from an earlier shot. Harmless while
       // main.js discards the return, but Stage E consumes this for impact effects.
       _result.target = null;
       _result.headshot = false;
       result = _result;
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
       _result.kind = 'target';
       _result.t = tt;
       _result.target = target;
       _result.headshot = headshot;
       result = _result;
       }
     }

    if (!result) return null;
    if (result.kind === 'wall') return result;

      // A bot was the nearest hit: apply damage (4x on the head) and report it.
    const damage = weapon.damage * (result.headshot ? 4 : 1);
    result.target.onHit(damage, result.headshot, weapon);
    // A bot's onHit is takeDamage, which emits 'hit' itself — and must, because
    // grenade blast damage reaches takeDamage directly without passing through
    // hitscan. A remote player's onHit only reports the hit upward and emits
    // nothing, so the local feedback event is ours to fire here. Exactly one
    // 'hit' per damage instance from every source.
    if (result.target.reportHit) {
      events.emit('hit', { target: result.target, damage, headshot: result.headshot });
    }
    return result;
   }
