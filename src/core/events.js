// Tiny EventBus for cross-module messages. Listeners are kept per event name in
// a Set so order is insertion order and `off` is O(1). The whole game shares one
// instance (see `events` at the bottom) so systems never import each other directly.
export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  // Register `fn` for `name`. Returns an unsubscribe function for convenience.
  on(name, fn) {
    let set = this._listeners.get(name);
    if (!set) {
      set = new Set();
      this._listeners.set(name, set);
    }
    set.add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    const set = this._listeners.get(name);
    if (set) set.delete(fn);
  }

  // Call every listener for `name` with `payload`. Missing listeners is a no-op.
  emit(name, payload) {
    const set = this._listeners.get(name);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

// One shared bus for the whole game.
export const events = new EventBus();
