import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { beveledBox } from './shapes.js';

// Procedural first-person weapon models. Each gun is assembled from chamfered boxes
// and lathed/cylindrical parts, then merged per material so a weapon costs two draw
// calls. Local space: the gun points along -Z, the grip hangs below the origin.
// Built once per kind and cached — switching weapons swaps which cached group is
// shown, it never rebuilds.
const GUNMETAL = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.40, metalness: 0.60 });
const POLYMER  = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.75, metalness: 0.00 });

const _cache = new Map();

// A small builder that collects geometries per material for a single merge.
class Parts {
  constructor() { this.metal = []; this.poly = []; }
  _add(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    // mergeGeometries refuses to mix indexed and non-indexed inputs, and it fails by
    // returning null. ExtrudeGeometry is non-indexed; Cylinder/Torus/Lathe are
    // indexed — normalise everything to non-indexed before collecting.
    if (geo.index) geo = geo.toNonIndexed();
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    (mat === GUNMETAL ? this.metal : this.poly).push(geo);
  }
  box(w, h, d, x, y, z, mat = GUNMETAL, rx = 0) {
    this._add(beveledBox(w, h, d, Math.min(w, h, d) * 0.12), mat, x, y, z, rx);
  }
  // A cylinder along -Z (CylinderGeometry is built along Y, so rotate it over).
  tube(r, len, x, y, z, mat = GUNMETAL) {
    this._add(new THREE.CylinderGeometry(r, r, len, 14), mat, x, y, z, Math.PI / 2);
  }
  // A cylinder along X, for a bolt handle.
  peg(r, len, x, y, z, mat = GUNMETAL) {
    this._add(new THREE.CylinderGeometry(r, r, len, 10), mat, x, y, z, 0, 0, Math.PI / 2);
  }
  ring(r, tube, x, y, z, mat = GUNMETAL) {
    this._add(new THREE.TorusGeometry(r, tube, 8, 18), mat, x, y, z);
  }
  // A stepped barrel profile turned on a lathe, laid along -Z starting at zStart.
  lathe(profile, zStart, x, y, mat = GUNMETAL) {
    const pts = profile.map(([r, l]) => new THREE.Vector2(r, l));
    const geo = new THREE.LatheGeometry(pts, 16);
    geo.rotateX(Math.PI / 2); // +Y → -Z
    this._add(geo, mat, x, y, zStart);
  }
  finish() {
    const group = new THREE.Group();
    for (const [list, mat] of [[this.metal, GUNMETAL], [this.poly, POLYMER]]) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

const BUILDERS = {
  pistol(p) {
    p.box(0.036, 0.045, 0.170,  0,  0.030, -0.085);            // slide
    p.box(0.034, 0.030, 0.130,  0,  0.000, -0.065, POLYMER);   // frame
    p.tube(0.008, 0.050,        0,  0.035, -0.190);            // barrel
    p.box(0.032, 0.085, 0.045,  0, -0.050, -0.010, POLYMER, -0.25); // grip
    p.box(0.006, 0.012, 0.010,  0,  0.058, -0.160);            // front sight
    p.box(0.020, 0.012, 0.010,  0,  0.058, -0.020);            // rear sight
    return -0.215;
  },
  rifle(p) {
    p.box(0.050, 0.065, 0.240,  0,  0.000, -0.200);            // receiver
    p.box(0.048, 0.050, 0.160,  0,  0.005, -0.400, POLYMER);   // handguard
    p.tube(0.011, 0.100,        0,  0.010, -0.530);            // barrel
    p.box(0.028, 0.130, 0.060,  0, -0.085, -0.200, GUNMETAL, 0.20); // magazine
    p.box(0.032, 0.090, 0.045,  0, -0.070, -0.090, POLYMER, -0.30); // grip
    p.box(0.040, 0.060, 0.150,  0, -0.010,  0.000, POLYMER);   // stock
    p.box(0.020, 0.030, 0.060,  0,  0.050, -0.140);            // rear sight block
    p.box(0.008, 0.030, 0.010,  0,  0.045, -0.460);            // front sight
    return -0.580;
  },
  shotgun(p) {
    p.box(0.050, 0.070, 0.200,  0,  0.000, -0.180);            // receiver
    p.tube(0.013, 0.260,        0,  0.020, -0.410);            // barrel
    p.tube(0.011, 0.220,        0, -0.010, -0.390);            // tube magazine
    p.box(0.050, 0.050, 0.100,  0,  0.000, -0.330, POLYMER);   // pump
    p.box(0.045, 0.065, 0.170,  0, -0.015,  0.010, POLYMER);   // stock
    p.box(0.008, 0.010, 0.010,  0,  0.040, -0.530);            // bead
    return -0.540;
  },
  sniper(p) {
    p.box(0.050, 0.065, 0.260,  0,  0.000, -0.210);            // receiver
    p.lathe([[0.014, 0], [0.014, 0.12], [0.011, 0.12], [0.011, 0.30]], -0.340, 0, 0.012); // stepped barrel
    p.tube(0.017, 0.150,        0,  0.060, -0.200);            // scope body
    p.ring(0.020, 0.004,        0,  0.060, -0.140);            // scope ring
    p.ring(0.020, 0.004,        0,  0.060, -0.260);            // scope ring
    p.box(0.045, 0.070, 0.200,  0, -0.015,  0.020, POLYMER);   // stock
    p.box(0.040, 0.020, 0.080,  0,  0.030,  0.040, POLYMER);   // cheek riser
    p.box(0.026, 0.070, 0.050,  0, -0.060, -0.200);            // magazine
    p.box(0.032, 0.090, 0.045,  0, -0.070, -0.100, POLYMER, -0.30); // grip
    p.peg(0.006, 0.040,     0.030,  0.020, -0.120);            // bolt handle
    return -0.640;
  },
};

// Returns { group, muzzleZ } for a weapon kind. Cached; the same group is
// returned every time, so callers must not modify it beyond reparenting.
export function getGun(kind) {
  const key = BUILDERS[kind] ? kind : 'rifle';
  let entry = _cache.get(key);
  if (!entry) {
    const parts = new Parts();
    const muzzleZ = BUILDERS[key](parts);
    entry = { group: parts.finish(), muzzleZ };
    _cache.set(key, entry);
  }
  return entry;
}
