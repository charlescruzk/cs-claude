// The blockout map as plain data. Origin is the center; +z is the CT (south) end,
// -z is the T (north) end. Every box is axis-aligned: `pos` is the center and
// `size` is [w, h, d] in meters. `tex` is a texture kind resolved by mapBuilder.
// Kept under 80 boxes. The floor and bombsite rings are drawn by mapBuilder, not
// listed here, so `colliders.length` equals `boxes.length` exactly.

export const mapData = {
  boxes: [
     // --- perimeter walls ---
    { pos: [0, 2, -30],  size: [61, 4, 1],  tex: 'concrete' }, // north
    { pos: [0, 2, 30],   size: [61, 4, 1],  tex: 'concrete' }, // south
    { pos: [30, 2, 0],   size: [1, 4, 61],  tex: 'concrete' }, // east
    { pos: [-30, 2, 0],  size: [1, 4, 61],  tex: 'concrete' }, // west

     // --- central corridor: the long lane, 30 m, running north-south ---
    { pos: [-4, 2, 0], size: [1, 4, 30], tex: 'concrete' }, // west wall of lane
    { pos: [4, 2, 0],  size: [1, 4, 30], tex: 'concrete' }, // east wall of lane

     // --- wing dividers, each with an open gap at its ends ---
    { pos: [16, 2, -6],  size: [1, 4, 20], tex: 'concrete' }, // east wing
    { pos: [-16, 2, 8],  size: [1, 4, 18], tex: 'concrete' }, // west wing

     // --- mid area: scattered crate cover in the lane center ---
    { pos: [0, 0.5, 0],     size: [1, 1, 1], tex: 'crate' },
    { pos: [1.3, 0.5, -1.3], size: [1, 1, 1], tex: 'crate' },
    { pos: [-1.3, 0.5, 1.3], size: [1, 1, 1], tex: 'crate' },
    { pos: [2.6, 0.5, 2.6],  size: [1, 1, 1], tex: 'crate' },
    { pos: [0, 0.5, 8],      size: [1, 1, 1], tex: 'crate' }, // lane cover
    { pos: [0, 0.5, -8],     size: [1, 1, 1], tex: 'crate' },

     // --- ledge 1: two stacked 1 m crates => a 2 m ledge, west wing ---
    { pos: [-20, 0.5, 10], size: [3, 1, 3], tex: 'crate' },
    { pos: [-20, 1.5, 10], size: [3, 1, 3], tex: 'crate' },

     // --- ledge 2: two stacked 1 m crates => a 2 m ledge, east wing ---
    { pos: [20, 0.5, -10], size: [3, 1, 3], tex: 'crate' },
    { pos: [20, 1.5, -10], size: [3, 1, 3], tex: 'crate' },

     // --- a single 1 m jumpable box in the east plaza ---
    { pos: [24, 0.5, 20], size: [4, 1, 4], tex: 'crate' },

     // --- T-side cover (north, -z) ---
    { pos: [-8, 0.5, -24], size: [2, 1, 2], tex: 'crate' },
    { pos: [8, 0.5, -24],  size: [2, 1, 2], tex: 'crate' },
    { pos: [14, 0.5, -26], size: [2, 1, 3], tex: 'sand' },

     // --- CT-side cover (south, +z) ---
    { pos: [-8, 0.5, 24],  size: [2, 1, 2], tex: 'crate' },
    { pos: [8, 0.5, 24],   size: [2, 1, 2], tex: 'crate' },
    { pos: [0, 0.5, 26],   size: [3, 1, 1], tex: 'crate' },

     // --- bombsite A: a low platform over the open T-end plaza (east) ---
    { pos: [20, 0.1, -18], size: [10, 0.2, 10], tex: 'concrete' },
  ],

   // [x, z] pairs on the floor. T (north, -z) and CT (south, +z) face off.
  spawns: {
    t: [
      [-10, -25], [-3, -26], [3, -26], [10, -25], [0, -22], [16, -26],
    ],
    ct: [
      [-10, 25], [-3, 26], [3, 26], [10, 25], [0, 22], [16, 24],
    ],
  },

  // Open plazas to be planted. P0 only marks them; the plant is a P1 feature.
  sites: [
    { name: 'A', pos: [20, 0, -18] },
  ],
};
