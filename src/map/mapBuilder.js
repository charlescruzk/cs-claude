import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTexture, makeRoughness } from './textures.js';
import { beveledBox, boxProjectUvs } from '../geo/shapes.js';

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
  const floorGeo = new THREE.PlaneGeometry(62, 62);
  // One tile covers 2 m, carried in the UVs like every other surface; the material
  // repeat is 1x1 to match the boxes (overriding the cached texture's 4x4 repeat).
  boxProjectUvs(floorGeo, 2);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughnessMap: makeRoughness('floor'),
      roughness: 0.9,
      metalness: 0.0,
    })
  );
  floor.material.map.repeat.set(1, 1);
  floor.material.roughnessMap.repeat.set(1, 1);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true; // the floor catches shadows but casts none
  scene.add(floor);

   // Group boxes by texture kind, then merge each group into one mesh. Colliders
   // are built from mapData.boxes in the same order as before, independent of the
   // meshes. UVs are scaled so one tile covers 2 m, so a 61 m wall and a 1 m crate
   // tile at the same density.
  const byKind = new Map();
  for (const box of mapData.boxes) {
    const [x, y, z] = box.pos;
    const [w, h, d] = box.size;

    const list = byKind.get(box.tex) || [];
    list.push(box);
    byKind.set(box.tex, list);

    colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    });
   }

  for (const [kind, boxes] of byKind) {
    const geos = boxes.map((box) => {
      const [w, h, d] = box.size;
      // Chamfer by the box's smallest dimension: 2 cm on a 1 m crate, 4 cm on
      // walls and large masses. Visual only — colliders still use the full box.
      const chamfer = Math.min(w, h, d) < 1.5 ? 0.02 : 0.04;
      const geo = beveledBox(w, h, d, chamfer);
      boxProjectUvs(geo, 2);
      geo.translate(box.pos[0], box.pos[1], box.pos[2]);
      return geo;
    });
    const mat = getMaterial(matCache, kind);
    mat.map.repeat.set(1, 1);          // UVs carry the tiling now
    mat.roughnessMap.repeat.set(1, 1); // (both maps, or the grain would double-tile)
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
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
