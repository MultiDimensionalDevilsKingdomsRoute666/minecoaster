/**
 * Turns the abstract spline into visible wooden-coaster hardware:
 * two steel rails (ribbon geometry swept along the parallel-transport
 * frames), plank cross-ties, and support pillars dropped to the terrain.
 */
import * as THREE from 'three';
import type { Track } from '../coaster/track';
import type { World } from '../world/worldgen';
import { generateTexture } from '../art/textures';
import { dataTextureFrom } from './gfx';

const RAIL_HALF_GAUGE = 0.55;
const RAIL_SIZE = 0.12;
const TIE_SPACING = 1.1;
const SUPPORT_SPACING = 4;

function railGeometry(track: Track, side: number): THREE.BufferGeometry {
  const step = 0.5;
  const count = Math.ceil(track.length / step);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // square cross-section: 4 corners in the (normal, binormal) plane
  const corners = [
    { n: 1, b: 1 },
    { n: 1, b: -1 },
    { n: -1, b: -1 },
    { n: -1, b: 1 },
  ];

  for (let i = 0; i <= count; i++) {
    const s = Math.min(i * step, track.length);
    const f = track.frameAt(s);
    const center = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z)
      .addScaledVector(new THREE.Vector3(f.binormal.x, f.binormal.y, f.binormal.z), side * RAIL_HALF_GAUGE);
    const n = new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z);
    const b = new THREE.Vector3(f.binormal.x, f.binormal.y, f.binormal.z);
    for (const c of corners) {
      positions.push(
        center.x + (n.x * c.n + b.x * c.b) * RAIL_SIZE,
        center.y + (n.y * c.n + b.y * c.b) * RAIL_SIZE,
        center.z + (n.z * c.n + b.z * c.b) * RAIL_SIZE,
      );
      const vn = new THREE.Vector3()
        .addScaledVector(n, c.n)
        .addScaledVector(b, c.b)
        .normalize();
      normals.push(vn.x, vn.y, vn.z);
    }
    if (i > 0) {
      const a = (i - 1) * 4;
      const d = i * 4;
      for (let e = 0; e < 4; e++) {
        const e2 = (e + 1) % 4;
        indices.push(a + e, d + e, d + e2, a + e, d + e2, a + e2);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

export function buildTrackGroup(track: Track, world: World, seed: number): THREE.Group {
  const group = new THREE.Group();

  const railMaterial = new THREE.MeshStandardMaterial({
    color: '#5a5e66',
    metalness: 0.8,
    roughness: 0.45,
  });
  group.add(new THREE.Mesh(railGeometry(track, 1), railMaterial));
  group.add(new THREE.Mesh(railGeometry(track, -1), railMaterial));

  const plankTex = dataTextureFrom(generateTexture('oak_planks', seed));
  const logTex = dataTextureFrom(generateTexture('oak_log_side', seed));

  // cross-ties
  const tieCount = Math.floor(track.length / TIE_SPACING);
  const tieGeo = new THREE.BoxGeometry(1.7, 0.12, 0.45);
  const tieMat = new THREE.MeshLambertMaterial({ map: plankTex });
  const ties = new THREE.InstancedMesh(tieGeo, tieMat, tieCount);
  const m = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  for (let i = 0; i < tieCount; i++) {
    const f = track.frameAt(i * TIE_SPACING);
    const t = new THREE.Vector3(f.tangent.x, f.tangent.y, f.tangent.z);
    const n = new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z);
    const b = new THREE.Vector3(f.binormal.x, f.binormal.y, f.binormal.z);
    // box X axis along binormal (tie spans the gauge), Y along normal, Z along tangent
    basis.makeBasis(b, n, t);
    m.copy(basis).setPosition(
      f.pos.x - n.x * (RAIL_SIZE + 0.07),
      f.pos.y - n.y * (RAIL_SIZE + 0.07),
      f.pos.z - n.z * (RAIL_SIZE + 0.07),
    );
    ties.setMatrixAt(i, m);
  }
  group.add(ties);

  // support pillars where the track flies above terrain
  const supports: { x: number; y: number; z: number; h: number }[] = [];
  for (let s = 0; s < track.length; s += SUPPORT_SPACING) {
    const p = track.posAt(s);
    const ground = world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1;
    const clearance = p.y - 0.4 - ground;
    if (clearance > 1.2 && clearance < 60) {
      supports.push({ x: p.x, y: ground, z: p.z, h: clearance });
    }
  }
  if (supports.length > 0) {
    const postGeo = new THREE.BoxGeometry(0.35, 1, 0.35);
    const postMat = new THREE.MeshLambertMaterial({ map: logTex });
    const posts = new THREE.InstancedMesh(postGeo, postMat, supports.length);
    for (let i = 0; i < supports.length; i++) {
      const sup = supports[i];
      m.makeScale(1, sup.h, 1).setPosition(sup.x, sup.y + sup.h / 2, sup.z);
      posts.setMatrixAt(i, m);
    }
    group.add(posts);
  }

  return group;
}

/** The ride vehicle: plank body, iron trim, wheels, and a TNT block passenger. */
export function buildCart(seed: number): THREE.Group {
  const cart = new THREE.Group();
  const plankTex = dataTextureFrom(generateTexture('oak_planks', seed));
  const ironTex = dataTextureFrom(generateTexture('iron_block', seed));
  const tntSideTex = dataTextureFrom(generateTexture('tnt_side', seed));
  const tntTopTex = dataTextureFrom(generateTexture('tnt_top', seed));

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.55, 2.1),
    new THREE.MeshLambertMaterial({ map: plankTex }),
  );
  body.position.y = 0.45;
  cart.add(body);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(1.42, 0.14, 2.22),
    new THREE.MeshLambertMaterial({ map: ironTex }),
  );
  rim.position.y = 0.76;
  cart.add(rim);

  const tntMat = [
    new THREE.MeshLambertMaterial({ map: tntSideTex }),
    new THREE.MeshLambertMaterial({ map: tntSideTex }),
    new THREE.MeshLambertMaterial({ map: tntTopTex }),
    new THREE.MeshLambertMaterial({ map: tntTopTex }),
    new THREE.MeshLambertMaterial({ map: tntSideTex }),
    new THREE.MeshLambertMaterial({ map: tntSideTex }),
  ];
  const passenger = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), tntMat);
  passenger.position.set(0, 1.1, -0.3);
  cart.add(passenger);

  const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#23252b', metalness: 0.6, roughness: 0.5 });
  for (const [wx, wz] of [
    [-0.62, 0.7],
    [0.62, 0.7],
    [-0.62, -0.7],
    [0.62, -0.7],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, 0.22, wz);
    cart.add(wheel);
  }
  return cart;
}
