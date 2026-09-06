import { events } from '../core/events.js';

// The player's combat state. Starts at the CS 1.6 defaults; `takeDamage` reduces
// health and, at zero, emits a `kill` with victim 'player' so the round loop and
// HUD can react. Also emits `hit` (target 'player') so the HUD can flash on damage.
export class PlayerState {
  constructor() {
     // Money and armor persist across round resets; only health/alive reset.
    this.team = 't';
    this.money = 800;
    this.armor = 0;
    this.helmet = false;
    this.reset();
    }

  reset() {
    this.health = 100;
    this.alive = true;
    }

  // `amount` is incoming damage. `headshot` and `weapon` are optional context for
  // the hit/kill events; armor mitigates 50% of non-headshots (see below).
  takeDamage(amount, headshot = false, weapon = null, killer = 'bot') {
    if (!this.alive) return;
      // Kevlar mitigates 50% of non-headshot damage, draining armor by the
    // absorbed half; headshots and armorless hits go straight to health.
    let dmg = amount;
    if (this.armor > 0 && !headshot) {
      const original = dmg;
      dmg *= 0.5;
      this.armor = Math.max(0, this.armor - (original - dmg));
      }
    this.health -= dmg;
    events.emit('hit', { target: 'player', damage: dmg, headshot });
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      events.emit('kill', { killer, victim: 'player', weapon, headshot });
     }
   }
}
