import { events } from '../core/events.js';

// The player's combat state. Starts at the CS 1.6 defaults; `takeDamage` reduces
// health and, at zero, emits a `kill` with victim 'player' so the round loop and
// HUD can react. Also emits `hit` (target 'player') so the HUD can flash on damage.
export class PlayerState {
  constructor() {
    this.reset();
    }

  reset() {
    this.health = 100;
    this.armor = 0;
    this.money = 800;
    this.team = 't';
    this.alive = true;
    }

  // `amount` is incoming damage. `headshot` and `weapon` are optional context for
  // the events; P0 bots deal flat damage with no headshot.
  takeDamage(amount, headshot = false, weapon = null) {
    if (!this.alive) return;
    this.health -= amount;
    events.emit('hit', { target: 'player', damage: amount, headshot });
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      events.emit('kill', { killer: 'bot', victim: 'player', weapon });
     }
   }
}
