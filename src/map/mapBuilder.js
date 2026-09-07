import * as THREE from 'three';
import { makeTexture, makeRoughness } from './textures.js';

// Per-surface roughness. Concrete is nearly matte; crates are slightly less so.
const ROUGHNESS = { concrete: 0.95, crate: 0.80, sand: 1.0, floor: 0.90 };

// Turn `mapData` into visible meshes plus a flat list of AABB colliders.
// Returns { colliders, spawns, sites }. `colliders` holds one { min, max } pair per
// box in mapData.boxes, so its length equals the box count. Materials are cached per
// texture kind; the floor and bombsite rings are added here (not in mapData).
export function buildMap(mapData, scene) {
  const colliders = [];
  const matCache = new Map();

   // Floor: a large flat plane at y=0. Collision with it is handled by the
   // controller's ground check, not by the collider list, so it is not added below.
  const floorTex = makeTexture('floor');
  floorTex.repeat.set(30, 30);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 62),
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughnessMap: makeRoughness('floor'),
      roughness: 0.9,
      metalness: 0.0,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

   // One mesh + one collider per box.
  for (const box of mapData.boxes) {
    const [x, y, z] = box.pos;
    const [w, h, d] = box.size;

    const mat = getMaterial(matCache, box.tex);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
   }

   // Bombsite rings (visual only, not colliders).
  for (const site of mapData.sites) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2, 3, 40),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.pos[0], 0.25, site.pos[2]);
    scene.add(ring);
    }

  return { colliders, spawns: mapData.spawns, sites: mapData.sites };
}

// Lazily build and share a Standard material per texture kind.
function getMaterial(cache, kind) {
  let mat = cache.get(kind);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: makeTexture(kind),
      roughnessMap: makeRoughness(kind),
      roughness: ROUGHNESS[kind] ?? 0.9,
      metalness: 0.0,
    });
    cache.set(kind, mat);
   }
  return mat;
}
