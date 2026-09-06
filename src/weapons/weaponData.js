// Per-weapon stats as plain data, looked up by key from weapon.js. Units follow
// ARCHITECTURE.md: rpm is shots per minute, spreads are radians, reload in seconds.
// `auto` selects full-auto vs semi-auto; `pellets` (shotgun) fans out that many
// hitscans per pull in main.js. The rifle also grows its spread per shot while the
// trigger is held and resets it a moment after release.
export const WEAPON_KEYS = ['pistol', 'rifle', 'shotgun', 'sniper'];

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
  shotgun: {
    name: 'Shotgun',
    damage: 20,              // per pellet; 8 pellets open a wide close-range cone
    rpm: 120,
    pellets: 8,              // one pull fans out this many hitscans in main.js
    mag: 8,
    reserve: 64,
    spread: 0.06,            // wide; each pellet is perturbed independently
    recoil: 0.04,
    auto: false,
    reloadTime: 1.8,
   },
  sniper: {
    name: 'Sniper',
    damage: 100,             // 4x headshot (400) instakills; scoping added in P1-2
    rpm: 60,
    mag: 1,
    reserve: 10,
    spread: 0.0,             // precise; an essentially non-perturbed ray
    recoil: 0.08,            // heavy single kick
    auto: false,
    scoped: true,            // consumed by P1-2's scope
    reloadTime: 3.0,
   },
};
