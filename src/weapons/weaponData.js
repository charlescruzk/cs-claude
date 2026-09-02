// Per-weapon stats as plain data, looked up by key from weapon.js. Units follow
// ARCHITECTURE.md: rpm is shots per minute, spreads are radians, reload in seconds.
// `auto` selects full-auto (rifle) vs semi-auto (pistol). The rifle also grows its
// spread per shot while the trigger is held and resets it a moment after release.
export const WEAPON_KEYS = ['pistol', 'rifle'];

export const weaponData = {
  pistol: {
    name: 'Pistol',
    damage: 34,
    rpm: 400,
    mag: 12,
    reserve: 100,
    spread: 0.01,
    recoil: 0.015,
    auto: false,
    reloadTime: 2.2,
  },
  rifle: {
    name: 'Rifle',
    damage: 36,
    rpm: 600,
    mag: 30,
    reserve: 90,
    spread: 0.006,      // base; grows +spreadPerShot per shot while held
    spreadPerShot: 0.004,
    spreadRecover: 0.3, // seconds after release before spread resets to base
    recoil: 0.02,
    auto: true,
    reloadTime: 2.5,
  },
};
