// Bot data: patrol waypoints, display names, and how many bots to field.
// Waypoints are [x, z] pairs; bots find their own height now (gravity + the
// resolver land them on stairs/platforms), so elevated spots like the Site A
// platform and the catwalk are reachable when a staircase leads to them.
// Names are neutral codenames — no Valve assets.
export const waypoints = [
  // CT spawn yard (south, +z)
  [0, 25], [-8, 25], [8, 25],
  // T spawn yard (north, -z)
  [0, -25], [-8, -25], [8, -25],
  // Mid corridor (split by the catwalk at z in [-1,1]; keep waypoints clear of it)
  [0, 10], [0, -2], [0, -10],
  // West lane (x ≈ -20); (-20, 12) is the Site B bay
  [-20, 0], [-20, -10], [-20, 12],
  // East lane (x ≈ +20)
  [20, 10], [20, 0],
  // Ground approach to the Site A mid staircase
  [10, -14],
  // Site A platform (2 m)
  [18, -14],
  // Catwalk (3 m), crossing mid east–west near z ≈ 0
  [-15, 0], [15, 0],
];

export const names = [
 'Viper', 'Ghost', 'Falcon', 'Reaper', 'Specter', 'Bandit', 'Cobra', 'Talon',
];

export const count = 4;
