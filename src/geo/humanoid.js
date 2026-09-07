import * as THREE from 'three';
import { beveledBox } from './shapes.js';

// An angular, faceted humanoid built from chamfered boxes: plate torso and pauldrons
// in team colour, dark segmented limbs, grey helmet with a black visor slab. Every
// limb segment is its own named mesh so the ragdoll can pose them independently.
// Geometry and materials are shared across every figure; nothing is allocated per
// bot beyond the Mesh wrappers themselves.
const C = 0.015; // chamfer on every part

const GEO = {
  head:     beveledBox(0.24, 0.26, 0.26, C),
  visor:    new THREE.BoxGeometry(0.20, 0.06, 0.02),
  torso:    beveledBox(0.48, 0.58, 0.28, C),
  pelvis:   beveledBox(0.36, 0.20, 0.26, C),
  upperArm: beveledBox(0.13, 0.32, 0.15, C),
  lowerArm: beveledBox(0.11, 0.30, 0.13, C),
  thigh:    beveledBox(0.18, 0.42, 0.20, C),
  shin:     beveledBox(0.15, 0.40, 0.17, C),
  pauldron: beveledBox(0.16, 0.10, 0.18, C),
};

const DARK = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.70, metalness: 0.10 });
const GREY = new THREE.MeshStandardMaterial({ color: 0x55555c, roughness: 0.80, metalness: 0.05 });
const teamMats = new Map();
function teamMat(color) {
  let m = teamMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });
    teamMats.set(color, m);
  }
  return m;
}

// Bind pose: part centres relative to the feet at y=0, for a 1.8 m figure.
// The ragdoll restores these on respawn.
export const BIND = {
  head:      [0, 1.66, 0],
  torso:     [0, 1.24, 0],
  pelvis:    [0, 0.88, 0],
  upperArmL: [-0.30, 1.36, 0], upperArmR: [0.30, 1.36, 0],
  lowerArmL: [-0.30, 1.04, 0], lowerArmR: [0.30, 1.04, 0],
  thighL:    [-0.11, 0.60, 0], thighR:    [0.11, 0.60, 0],
  shinL:     [-0.11, 0.20, 0], shinR:     [0.11, 0.20, 0],
  pauldronL: [-0.34, 1.50, 0], pauldronR: [0.34, 1.50, 0],
};

const PART_GEO = {
  head: 'head', torso: 'torso', pelvis: 'pelvis',
  upperArmL: 'upperArm', upperArmR: 'upperArm',
  lowerArmL: 'lowerArm', lowerArmR: 'lowerArm',
  thighL: 'thigh', thighR: 'thigh',
  shinL: 'shin', shinR: 'shin',
  pauldronL: 'pauldron', pauldronR: 'pauldron',
};

// Which material each part wears. Team colour on the plates that read at distance.
function partMaterial(name, team) {
  if (name === 'torso' || name.startsWith('pauldron')) return team;
  if (name === 'head' || name === 'pelvis') return GREY;
  return DARK;
}

// Returns { root, parts } where parts maps every BIND name to its Mesh.
export function buildHumanoid(teamColor) {
  const root = new THREE.Group();
  const team = teamMat(teamColor);
  const parts = {};
  for (const name of Object.keys(BIND)) {
    const mesh = new THREE.Mesh(GEO[PART_GEO[name]], partMaterial(name, team));
    const p = BIND[name];
    mesh.position.set(p[0], p[1], p[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    parts[name] = mesh;
  }
  // The visor rides on the head so it follows it through the ragdoll.
  const visor = new THREE.Mesh(GEO.visor, DARK);
  visor.position.set(0, 0.02, -0.135);
  parts.head.add(visor);
  return { root, parts };
}

// Recolour the team plates (torso and pauldrons) on an existing figure.
export function applyTeam(parts, teamColor) {
  const m = teamMat(teamColor);
  parts.torso.material = m;
  parts.pauldronL.material = m;
  parts.pauldronR.material = m;
}

// Put every part back in its bind pose (position and orientation).
export function resetPose(parts) {
  for (const name of Object.keys(BIND)) {
    const p = BIND[name];
    parts[name].position.set(p[0], p[1], p[2]);
    parts[name].quaternion.identity();
  }
}
