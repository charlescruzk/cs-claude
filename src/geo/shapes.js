import * as THREE from 'three';

// A box with all 12 edges chamfered. The rounded-rect Shape chamfers the four
// vertical edges; bevelEnabled chamfers the top and bottom rims. curveSegments: 1
// and bevelSegments: 1 keep them flat chamfers rather than rounded fillets, which
// is what reads as cast concrete rather than moulded plastic.
//
// bevelOffset: -c is what makes the box measure exactly w × h × d. ExtrudeGeometry
// places the body at bs = bevelSize + bevelOffset; with bevelOffset 0 the body is
// expanded by c on every side (a 1 m box came out 1.08 m). With -c the body sits
// on the original shape (exact w × d) and the top/bottom faces contract by c —
// which is how a real chamfer reads anyway.
export function beveledBox(w, h, d, chamfer = 0.04) {
  const c = Math.min(chamfer, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const x = w / 2 - c;
  const z = d / 2 - c;
  shape.moveTo(-x, -z - c);
  shape.lineTo(x, -z - c);
  shape.lineTo(x + c, -z);
  shape.lineTo(x + c, z);
  shape.lineTo(x, z + c);
  shape.lineTo(-x, z + c);
  shape.lineTo(-x - c, z);
  shape.lineTo(-x - c, -z);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h - 2 * c,
    bevelEnabled: true,
    bevelThickness: c,
    bevelSize: c,
    bevelOffset: -c,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });

  // Extrude runs along +Z; rotate so it runs along +Y, then centre on the origin.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, h / 2, 0);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

// World-axis UV projection: for each vertex pick the dominant axis of its normal
// and project the other two coordinates as UV, scaled by 1 / metresPerTile. This
// works on any geometry (a beveled box has no BoxGeometry 6-face / 4-vertex UV
// layout) and gives one consistent texel density on every surface. Call it AFTER
// any rotate/translate/center so it projects final local coordinates.
export function boxProjectUvs(geo, metresPerTile = 2) {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const scale = 1 / metresPerTile;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const nz = Math.abs(norm.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (nx >= ny && nx >= nz) {
      uv.setXY(i, z * scale, y * scale); // +X/-X faces: project Z and Y
    } else if (ny >= nx && ny >= nz) {
      uv.setXY(i, x * scale, z * scale); // +Y/-Y faces: project X and Z
    } else {
      uv.setXY(i, x * scale, y * scale); // +Z/-Z faces: project X and Y
    }
  }
  return geo;
}
