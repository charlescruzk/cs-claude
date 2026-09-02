// Bot data: patrol waypoints, display names, and how many bots to field.
// Waypoints are [x, z] pairs in open floor (checked against mapData boxes) so
// bots actually reach them. Names are neutral codenames — no Valve assets.
export const waypoints = [
   [0, -20], [0, -6], [0, 6], [0, 20],   // the north–south lane
   [-24, -10], [-24, 14],                  // west wing
   [24, -16], [24, 10],                    // east wing
   [-10, -22], [10, 22],                   // the two ends
   [18, 18], [-20, -18],                   // far corners
];

export const names = [
 'Viper', 'Ghost', 'Falcon', 'Reaper', 'Specter', 'Bandit', 'Cobra', 'Talon',
];

export const count = 4;
