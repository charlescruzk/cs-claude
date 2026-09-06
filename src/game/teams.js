// Team constants and spawn assignment for the round loop. mapData stores spawns
// as [x, z] pairs; `spawnFor` normalizes them to the { x, z } feet position that
// the player controller and bot spawnAt expect.
export const TEAMS = {
   t: { id: 't',  name: 'Terrorists',         color: 0xcc6633 },
   ct: { id: 'ct', name: 'Counter-Terrorists', color: 0x3355cc },
};

// Pick a spawn for a team. `spawns` is { t: [[x,z],...], ct: [[x,z],...] }. With
// `index` the spawn is chosen by slot (i % count, distinct per caller); without it
// the pick is random — so the round loop gives the player a fresh spot each round
// while BotManager keeps bots on distinct slots.
export function spawnFor(team, spawns, index) {
   const list = spawns[team] || spawns.t || [];
   if (list.length === 0) return { x: 0, z: 0 };
   const i = index === undefined ? Math.floor(Math.random() * list.length) : index;
   const s = list[i % list.length];
    // Accept either the mapData [x, z] pair or an already-normalized { x, z }.
   return Array.isArray(s) ? { x: s[0], z: s[1] } : { x: s.x, z: s.z };
}
