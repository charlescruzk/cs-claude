import { Bot } from './bot.js';
import { names, count } from './botData.js';

// Fields a squad of CT bots from the CT spawns and steps them each frame. Bots
// fight the player (T): they patrol waypoints, engage on line-of-sight, and are
// the hittable `targets` the player's hitscan resolves against.
export class BotManager {
  constructor(scene, spawns) {
    this.scene = scene;
    this.spawns = spawns.ct; // bots are the CT team
    this.bots = [];
    for (let i = 0; i < count; i++) {
      const bot = new Bot(names[i % names.length], 'ct', scene);
      bot.spawnAt(this.spawns[i % this.spawns.length]);
      this.bots.push(bot);
    }
  }

  // All bots, alive or dead. resolveShot skips dead targets, so the round loop
  // can pass this straight in until P0-8 thins it.
  targets() {
    return this.bots;
  }

  update(dt, player, colliders) {
    for (const bot of this.bots) bot.update(dt, player, colliders);
  }

  aliveCount() {
    let n = 0;
    for (const bot of this.bots) if (!bot.dead) n++;
    return n;
  }

  // Re-spawn every bot at its slot, used by the round loop on reset (P0-8).
  resetAll() {
    for (let i = 0; i < this.bots.length; i++) {
      this.bots[i].spawnAt(this.spawns[i % this.spawns.length]);
    }
  }
}
