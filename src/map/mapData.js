// The blockout map as plain data. Origin is the center; +z is the CT (south) end,
// -z is the T (north) end. Every box is axis-aligned: `pos` is the center and
// `size` is [w, h, d] in meters. `tex` is a texture kind resolved by mapBuilder.
// Kept under 80 boxes (75 here). The floor and bombsite rings are drawn by
// mapBuilder, not listed here, so `colliders.length` equals `boxes.length` exactly.
//
// Layout: three north-south lanes (west lane x~-20, mid x in [-5,5], east lane
// x~+20) split by the 3 m catwalk at z=0. Site A is a 2 m platform in the
// north-east, reached by two 8-step staircases. Site B is a ground-level bay in
// the south-west, overlooked by a 3 m ledge off the catwalk. Every box is solid
// from the ground up; stairs are stacked blocks with 0.25 m risers / 0.9 m treads.

export const mapData = {
  boxes: [
    // --- perimeter walls: 8 m tall, inner faces at x/z = +/-30 ---
    { pos: [0, 4, -30.5],   size: [62, 8, 1],  tex: 'concrete' }, // north
    { pos: [0, 4, 30.5],    size: [62, 8, 1],  tex: 'concrete' }, // south
    { pos: [30.5, 4, 0],    size: [1, 8, 62],  tex: 'concrete' }, // east
    { pos: [-30.5, 4, 0],   size: [1, 8, 62],  tex: 'concrete' }, // west

    // --- mid corridor walls (x = +/-5), 2 m tall, gapped for the catwalk (z in
    // [-2,2]) and for the Site A staircase from mid (z in [-16,-12]) ---
    { pos: [-5, 1, -11], size: [1, 2, 18], tex: 'concrete' }, // west mid wall, north
    { pos: [-5, 1, 11],  size: [1, 2, 18], tex: 'concrete' }, // west mid wall, south
    { pos: [5, 1, -18],  size: [1, 2, 4],  tex: 'concrete' }, // east mid wall, north
    { pos: [5, 1, -7],   size: [1, 2, 10], tex: 'concrete' }, // east mid wall, mid
    { pos: [5, 1, 11],   size: [1, 2, 18], tex: 'concrete' }, // east mid wall, south

    // --- west lane east wall (x = -15), gapped for the catwalk ---
    { pos: [-15, 1, -11], size: [1, 2, 18], tex: 'concrete' },
    { pos: [-15, 1, 11],  size: [1, 2, 18], tex: 'concrete' },

    // --- east lane west wall (x = 15); the platform bounds the lane north of
    // z = -8, so the wall only runs south of it, gapped for the catwalk ---
    { pos: [15, 1, -5], size: [1, 2, 6],  tex: 'concrete' },
    { pos: [15, 1, 11], size: [1, 2, 18], tex: 'concrete' },

    // --- Site A: 2 m platform, 12x12, centred (18, -14) ---
    { pos: [18, 1, -14], size: [12, 2, 12], tex: 'concrete' },

    // --- Site A staircase from mid: 8 steps climbing east, base x=4.8, top at
    // x=11.1 (y=2.0) against the platform's west face at x=12 ---
    { pos: [4.8, 0.125, -14],  size: [0.9, 0.25, 2],  tex: 'concrete' },
    { pos: [5.7, 0.25, -14],   size: [0.9, 0.5, 2],   tex: 'concrete' },
    { pos: [6.6, 0.375, -14],  size: [0.9, 0.75, 2],  tex: 'concrete' },
    { pos: [7.5, 0.5, -14],    size: [0.9, 1.0, 2],   tex: 'concrete' },
    { pos: [8.4, 0.625, -14],  size: [0.9, 1.25, 2],  tex: 'concrete' },
    { pos: [9.3, 0.75, -14],   size: [0.9, 1.5, 2],   tex: 'concrete' },
    { pos: [10.2, 0.875, -14], size: [0.9, 1.75, 2],  tex: 'concrete' },
    { pos: [11.1, 1.0, -14],   size: [0.9, 2.0, 2],   tex: 'concrete' },

    // --- Site A staircase from the east lane: 8 steps climbing north at x=23,
    // base z=-0.8, top at z=-7.1 (y=2.0) against the platform's south face at
    // z=-8. East of the catwalk (x>20) so it never sits under it ---
    { pos: [23, 0.125, -0.8],  size: [2, 0.25, 0.9], tex: 'concrete' },
    { pos: [23, 0.25, -1.7],   size: [2, 0.5, 0.9],  tex: 'concrete' },
    { pos: [23, 0.375, -2.6],  size: [2, 0.75, 0.9], tex: 'concrete' },
    { pos: [23, 0.5, -3.5],    size: [2, 1.0, 0.9],  tex: 'concrete' },
    { pos: [23, 0.625, -4.4],  size: [2, 1.25, 0.9], tex: 'concrete' },
    { pos: [23, 0.75, -5.3],   size: [2, 1.5, 0.9],  tex: 'concrete' },
    { pos: [23, 0.875, -6.2],  size: [2, 1.75, 0.9], tex: 'concrete' },
    { pos: [23, 1.0, -7.1],    size: [2, 2.0, 0.9],  tex: 'concrete' },

    // --- catwalk: 3 m solid block, 2 m wide, crossing mid east-west at z=0.
    // Solid from the ground (per the platform rule) so it doubles as the mid
    // divider; players walk on top at y=3 and shoot down into mid ---
    { pos: [0, 1.5, 0], size: [40, 3, 2], tex: 'concrete' },

    // --- catwalk west staircase: 12 steps climbing north at x=-21, base
    // z=-10.8, top at z=-0.9 (y=3.0) against the catwalk's west face at x=-20 ---
    { pos: [-21, 0.125, -10.8],  size: [2, 0.25, 0.9],  tex: 'concrete' },
    { pos: [-21, 0.25, -9.9],    size: [2, 0.5, 0.9],   tex: 'concrete' },
    { pos: [-21, 0.375, -9.0],   size: [2, 0.75, 0.9],  tex: 'concrete' },
    { pos: [-21, 0.5, -8.1],     size: [2, 1.0, 0.9],   tex: 'concrete' },
    { pos: [-21, 0.625, -7.2],   size: [2, 1.25, 0.9],  tex: 'concrete' },
    { pos: [-21, 0.75, -6.3],    size: [2, 1.5, 0.9],   tex: 'concrete' },
    { pos: [-21, 0.875, -5.4],   size: [2, 1.75, 0.9],  tex: 'concrete' },
    { pos: [-21, 1.0, -4.5],     size: [2, 2.0, 0.9],   tex: 'concrete' },
    { pos: [-21, 1.125, -3.6],   size: [2, 2.25, 0.9],  tex: 'concrete' },
    { pos: [-21, 1.25, -2.7],    size: [2, 2.5, 0.9],   tex: 'concrete' },
    { pos: [-21, 1.375, -1.8],   size: [2, 2.75, 0.9],  tex: 'concrete' },
    { pos: [-21, 1.5, -0.9],     size: [2, 3.0, 0.9],   tex: 'concrete' },

    // --- catwalk east staircase: 12 steps descending south at x=21, top at
    // z=0 (y=3.0) against the catwalk's east face at x=20, base at z=9.9 ---
    { pos: [21, 1.5, 0],    size: [2, 3.0, 0.9],  tex: 'concrete' },
    { pos: [21, 1.375, 0.9], size: [2, 2.75, 0.9], tex: 'concrete' },
    { pos: [21, 1.25, 1.8],  size: [2, 2.5, 0.9],  tex: 'concrete' },
    { pos: [21, 1.125, 2.7], size: [2, 2.25, 0.9], tex: 'concrete' },
    { pos: [21, 1.0, 3.6],   size: [2, 2.0, 0.9],  tex: 'concrete' },
    { pos: [21, 0.875, 4.5], size: [2, 1.75, 0.9], tex: 'concrete' },
    { pos: [21, 0.75, 5.4],  size: [2, 1.5, 0.9],  tex: 'concrete' },
    { pos: [21, 0.625, 6.3], size: [2, 1.25, 0.9], tex: 'concrete' },
    { pos: [21, 0.5, 7.2],   size: [2, 1.0, 0.9],  tex: 'concrete' },
    { pos: [21, 0.375, 8.1], size: [2, 0.75, 0.9], tex: 'concrete' },
    { pos: [21, 0.25, 9.0],  size: [2, 0.5, 0.9],  tex: 'concrete' },
    { pos: [21, 0.125, 9.9], size: [2, 0.25, 0.9], tex: 'concrete' },

    // --- Site B ledge: 3 m solid block south of the catwalk's west end,
    // overlooking the Site B bay below ---
    { pos: [-20, 1.5, 2], size: [10, 3, 2], tex: 'concrete' },

    // --- Site B bay walls (x = -25), gapped at z in [10,14] so T can enter
    // from the west lane; the bay is open to the CT yard at z=20 ---
    { pos: [-25, 1, 6.5], size: [1, 2, 7], tex: 'concrete' },
    { pos: [-25, 1, 17],  size: [1, 2, 6], tex: 'concrete' },

    // --- west lane window wall at z=-16: a 1 m slot (y in [1,2]) between a
    // lower box and an upper box, so a crouching player can shoot through but
    // not walk through; the lane is passed around at x in [-30,-25] ---
    { pos: [-20, 0.5, -16], size: [10, 1, 1], tex: 'concrete' },
    { pos: [-20, 3, -16],   size: [10, 2, 1], tex: 'concrete' },

    // --- mid cover: two staggered 1 m crates (north half) and a 2 m pillar ---
    { pos: [0, 0.5, -6],  size: [1, 1, 1], tex: 'crate' },
    { pos: [2, 0.5, -3],  size: [1, 1, 1], tex: 'crate' },
    { pos: [-2, 1, 4],    size: [1, 2, 1], tex: 'concrete' },

    // --- T spawn cover (north yard) ---
    { pos: [-12, 0.5, -25], size: [2, 1, 2], tex: 'crate' },
    { pos: [12, 0.5, -25],  size: [2, 1, 2], tex: 'crate' },
    { pos: [0, 0.5, -27],   size: [2, 1, 2], tex: 'sand' },

    // --- CT spawn cover (south yard) ---
    { pos: [-10, 0.5, 25], size: [2, 1, 2], tex: 'crate' },
    { pos: [10, 0.5, 25],  size: [2, 1, 2], tex: 'crate' },
    { pos: [0, 0.5, 27],   size: [2, 1, 2], tex: 'sand' },

    // --- Site A platform cover ---
    { pos: [16, 2.5, -16], size: [1, 1, 1], tex: 'crate' },
    { pos: [21, 2.5, -11], size: [1, 1, 1], tex: 'crate' },

    // --- lane cover so no lane is a pure straight line ---
    { pos: [-22, 1, -14], size: [2, 2, 2], tex: 'concrete' }, // west lane
    { pos: [-18, 0.5, -6], size: [1, 1, 1], tex: 'crate' },   // west lane
    { pos: [25, 0.5, 6],  size: [1, 1, 1], tex: 'crate' },    // east lane
    { pos: [26, 1, -4],   size: [2, 2, 2], tex: 'concrete' }, // east lane
  ],

  // [x, z] pairs on the floor. T (north, -z) and CT (south, +z) face off.
  spawns: {
    t: [
      [-14, -25], [-5, -26], [5, -26], [14, -25], [0, -23], [22, -24],
    ],
    ct: [
      [-14, 25], [-5, 26], [5, 26], [14, 25], [0, 23], [22, 24],
    ],
  },

  // Bombsite markers. A sits on the 2 m platform (y=2); B sits on the ground in
  // the Site B bay. P0 only marks them; the plant is a P1 feature.
  sites: [
    { name: 'A', pos: [18, 2, -14] },
    { name: 'B', pos: [-20, 0, 12] },
  ],
};
