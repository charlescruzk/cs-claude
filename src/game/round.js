import { events } from '../core/events.js';
import { spawnFor } from './teams.js';

// Round state machine: freeze (5 s — no movement, but the player may look and
// switch weapons) -> live (1 m 55 s) -> end (5 s, winner banner) -> reset ->
// freeze. The live round ends early when the player dies or the last bot falls
// (a CT win vs a T win); a timer run-out is a CT win. Every transition emits
// 'roundState'; entering 'end' also emits 'roundEnd' with the winner. On reset the
// player returns to full health at a fresh T spawn, both weapons refill, and every
// bot respawns.
const FREEZE = 5;
const LIVE = 115;    // 1:55
const END = 5;
const DEAD_EYE = 0.3; // the camera drops this low on the player's death

export class Round {
   constructor({ player, controller, weapon, bots, spawns }) {
     this.player = player;        // PlayerState: health, alive, reset
     this.controller = controller; // PlayerController: spawnAt, disabled, frozen, eye
     this.weapon = weapon;        // Weapon: refill
     this.bots = bots;            // BotManager: resetAll, aliveCount
     this.spawns = spawns;        // { t: [[x,z],...], ct: [[x,z],...] }
     this.roundNumber = 1;
     this.score = { t: 0, ct: 0 };
     this.winner = null;
     this.state = 'freeze';
     this.time = FREEZE;
     this._onPlayerDeath = this._onPlayerDeath.bind(this);
     events.on('kill', this._onPlayerDeath);
     this._enter('freeze');
    }

   update(dt) {
     this.time -= dt;
     if (this.state === 'freeze') {
       if (this.time <= 0) this._enter('live');
       } else if (this.state === 'live') {
       if (this.time <= 0) this._endRound('ct');           // run-out: CT holds
       else if (this.bots.aliveCount() === 0) this._endRound('t'); // cleared: T
       } else { // 'end'
       if (this.time <= 0) this._reset();
        }
     }

      // A kill that fells the player ends the live round as a CT win. The camera
      // drops and the controller is disabled so the view holds on the corpse until
      // the round resets.
   _onPlayerDeath(p) {
     if (p.victim !== 'player' || this.state !== 'live') return;
     this.controller.disabled = true;
     this.controller.eye = DEAD_EYE;
     this._endRound('ct');
      }

      // Move into a state: set its countdown, freeze the player outside 'live', and
      // announce the change.
   _enter(state) {
     this.state = state;
     this.time = state === 'freeze' ? FREEZE : state === 'live' ? LIVE : END;
     this.controller.frozen = state !== 'live';
     events.emit('roundState', { state, timeLeft: this.time });
      }

      // Close the live round. Guarded so a death and a last-kill in the same frame
      // do not both count.
   _endRound(winner) {
     if (this.state !== 'live') return;
     this.winner = winner;
     this.score[winner] += 1;
     this._enter('end');
     events.emit('roundEnd', {
        winner,
        roundNumber: this.roundNumber,
        score: { ...this.score },
       });
      }

      // Start the next round: fresh T spawn, full health, weapons topped up, bots
      // back on the field.
   _reset() {
     this.roundNumber += 1;
     this.winner = null;
     this.controller.spawnAt(spawnFor('t', this.spawns));
     this.controller.disabled = false;
     this.player.reset();
     this.weapon.refill();
     this.bots.resetAll();
     this._enter('freeze');
      }
}
