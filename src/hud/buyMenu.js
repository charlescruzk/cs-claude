// A freeze-phase buy panel, on the scoreboard overlay pattern. `B` toggles a
// centered DOM panel while round.state is 'freeze'; it closes on B-again or when the
// round leaves freeze. Each item is { name, cost, apply() }; an unaffordable item is
// greyed and disabled. Buying deducts the cost and applies it immediately. Opening the
// panel releases pointer lock so the mouse can click; closing re-requests it (a browser
// may require a click gesture, in which case the #lock-overlay re-arms).
const ITEMS = (player, weapon) => [
  { name: 'Kevlar',          cost: 250, apply: () => { player.armor = 100; } },
  { name: 'Kevlar + Helmet', cost: 650, apply: () => { player.armor = 100; player.helmet = true; } },
  { name: 'Magazine Pack',   cost: 100, apply: () => { weapon.current.reserve = weapon.def.reserve; } },
];

export class BuyMenu {
  constructor(player, weapon, round, input) {
    this.player = player;
    this.weapon = weapon;
    this.round = round;
    this.input = input;
    this.panel = document.getElementById('buy-menu');
    this.itemsEl = document.getElementById('buy-items');
    this.moneyEl = document.getElementById('buy-money');
    this._shown = false;
    this._build();
  }

    // One button per item, wired to buy it; a live affordability pass runs each
    // frame the panel is open.
  _build() {
    this.items = ITEMS(this.player, this.weapon).map((item) => {
      const btn = document.createElement('button');
      btn.className = 'bm-item';
      btn.textContent = `${item.name}  —  $${item.cost}`;
      btn.addEventListener('click', () => this._buy(item));
      this.itemsEl.appendChild(btn);
      return { name: item.name, cost: item.cost, apply: item.apply, button: btn };
    });
    this._refresh();
  }

    // Open/close the panel and free / re-lock the pointer for clicking.
  open() {
    if (this._shown) return;
    this._shown = true;
    this.panel.style.display = 'flex';
    this._refresh();
    this.input.canvas.exitPointerLock(); // free the mouse (the probe stubs this)
  }

  close() {
    if (!this._shown) return;
    this._shown = false;
    this.panel.style.display = 'none';
    this.input.requestLock(); // best-effort re-lock; a browser may need a click
  }

    // Grey out unaffordable items and show the money on hand.
  _refresh() {
    if (this.moneyEl) this.moneyEl.textContent = `$${this.player.money}`;
    for (const it of this.items) {
      const poor = this.player.money < it.cost;
      it.button.disabled = poor;
      it.button.classList.toggle('poor', poor);
    }
  }

    // Deduct and apply, but only in freeze and only if the item is affordable.
  _buy(item) {
    if (this.round.state !== 'freeze') return;
    if (this.player.money < item.cost) return;
    this.player.money -= item.cost;
    item.apply();
    this._refresh();
  }

    // B toggles the panel in freeze; leaving freeze closes it. Runs every frame.
  update(dt, input) {
    this.input = input;
    const inFreeze = this.round.state === 'freeze';
    if (this._shown && !inFreeze) { this.close(); return; }
    if (inFreeze && input.justPressed('KeyB')) {
      if (this._shown) this.close(); else this.open();
    }
    if (this._shown) this._refresh();
  }
}
