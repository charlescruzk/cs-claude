import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
  const floorGeo = new THREE.PlaneGeometry(62, 62);
  // One tile covers 2 m (62/2 = 31 tiles). The cached texture's repeat is 4x4, so
  // the UVs are scaled by 31/4 = 7.75 to land on that density without mutating the
  // shared texture object (the latent bug this replaces).
  scaleUvs(floorGeo, 7.75, 7.75);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughnessMap: makeRoughness('floor'),
      roughness: 0.9,
      metalness: 0.0,
    })
  );
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
      const geo = new THREE.BoxGeometry(w, h, d);
      scaleBoxUvs(geo, w, h, d);
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

// Scale a BoxGeometry's UVs so one texture tile covers 2 m. A BoxGeometry's UVs
// run 0→1 per face; multiply each face's pairs by that face's size in metres / 2.
// Face order is +X, -X, +Y, -Y, +Z, -Z, each face 4 vertices (8 uv floats).
function scaleBoxUvs(geo, w, h, d) {
  const uv = geo.attributes.uv.array;
  const scales = [
    [d / 2, h / 2], [d / 2, h / 2],
    [w / 2, d / 2], [w / 2, d / 2],
    [w / 2, h / 2], [w / 2, h / 2],
  ];
  for (let f = 0; f < 6; f++) {
    const su = scales[f][0], sv = scales[f][1];
    for (let v = 0; v < 4; v++) {
      const i = (f * 4 + v) * 2;
      uv[i] *= su;
      uv[i + 1] *= sv;
    }
  }
  geo.attributes.uv.needsUpdate = true;
}

// Uniformly scale every UV pair (used for the floor plane).
function scaleUvs(geo, su, sv) {
  const uv = geo.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] *= su;
    uv[i + 1] *= sv;
  }
  geo.attributes.uv.needsUpdate = true;
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
