/**
 * Turns a voxel World into render-ready triangle buffers: one opaque mesh
 * plus separate water and lava meshes (they use different materials). Pure
 * math — the atlas is structurally typed so this never imports the art layer.
 */
import { Block } from './worldgen';
import type { BlockId, World } from './worldgen';

export interface AtlasTile {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface AtlasLike {
  tiles: Record<string, AtlasTile>;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** rgb per vertex */
  colors: Float32Array;
  indices: Uint32Array;
}

type FaceKind = 'top' | 'bottom' | 'side';

interface FaceDef {
  kind: FaceKind;
  normal: readonly [number, number, number];
  brightness: number;
  /** Corner offsets (0|1 per axis), CCW when viewed from outside. */
  corners: readonly (readonly [number, number, number])[];
  /** Per corner: pick u0|u1 then v0|v1. v0 lands on the visual top edge of side faces. */
  uvSel: readonly (readonly [0 | 1, 0 | 1])[];
}

const FACES: readonly FaceDef[] = [
  {
    kind: 'top',
    normal: [0, 1, 0],
    brightness: 1.0,
    corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    uvSel: [[0, 0], [0, 1], [1, 1], [1, 0]],
  },
  {
    kind: 'bottom',
    normal: [0, -1, 0],
    brightness: 0.55,
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    uvSel: [[0, 0], [1, 0], [1, 1], [0, 1]],
  },
  {
    kind: 'side',
    normal: [1, 0, 0],
    brightness: 0.7,
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    uvSel: [[0, 1], [1, 1], [1, 0], [0, 0]],
  },
  {
    kind: 'side',
    normal: [-1, 0, 0],
    brightness: 0.7,
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    uvSel: [[0, 1], [1, 1], [1, 0], [0, 0]],
  },
  {
    kind: 'side',
    normal: [0, 0, 1],
    brightness: 0.8,
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    uvSel: [[0, 1], [1, 1], [1, 0], [0, 0]],
  },
  {
    kind: 'side',
    normal: [0, 0, -1],
    brightness: 0.8,
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    uvSel: [[0, 1], [1, 1], [1, 0], [0, 0]],
  },
];

const AO_FACTOR = [1, 0.85, 0.72, 0.6] as const;

const UNIFORM_TILE: Partial<Record<BlockId, string>> = {
  [Block.Dirt]: 'dirt',
  [Block.Stone]: 'stone',
  [Block.Cobblestone]: 'cobblestone',
  [Block.Bedrock]: 'bedrock',
  [Block.Sand]: 'sand',
  [Block.Snow]: 'snow',
  [Block.Water]: 'water',
  [Block.Lava]: 'lava',
  [Block.OakLeaves]: 'oak_leaves',
  [Block.Planks]: 'oak_planks',
  [Block.GoldOre]: 'gold_ore',
  [Block.DiamondOre]: 'diamond_ore',
  [Block.Glowstone]: 'glowstone',
  [Block.IronBlock]: 'iron_block',
};

function tileNameFor(b: BlockId, kind: FaceKind): string {
  if (b === Block.Grass) {
    return kind === 'top' ? 'grass_top' : kind === 'bottom' ? 'dirt' : 'grass_side';
  }
  if (b === Block.OakLog) return kind === 'side' ? 'oak_log_side' : 'oak_log_top';
  if (b === Block.Tnt) return kind === 'side' ? 'tnt_side' : 'tnt_top';
  return UNIFORM_TILE[b] ?? 'stone';
}

function isSolid(b: BlockId): boolean {
  return b !== Block.Air && b !== Block.Water && b !== Block.Lava;
}

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  build(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }
}

/**
 * Ambient occlusion for one face corner: counts the up-to-3 solid blocks
 * (side1, side2, diagonal) touching that corner on the face's open side.
 */
function cornerAO(
  world: World,
  bx: number,
  by: number,
  bz: number,
  n: readonly [number, number, number],
  c: readonly [number, number, number],
): number {
  const cx = bx + n[0];
  const cy = by + n[1];
  const cz = bz + n[2];
  // Offsets along the two in-plane axes toward this corner.
  const dx = n[0] !== 0 ? 0 : c[0] === 1 ? 1 : -1;
  const dy = n[1] !== 0 ? 0 : c[1] === 1 ? 1 : -1;
  const dz = n[2] !== 0 ? 0 : c[2] === 1 ? 1 : -1;
  let s1: boolean;
  let s2: boolean;
  if (n[1] !== 0) {
    s1 = isSolid(world.get(cx + dx, cy, cz));
    s2 = isSolid(world.get(cx, cy, cz + dz));
  } else if (n[0] !== 0) {
    s1 = isSolid(world.get(cx, cy + dy, cz));
    s2 = isSolid(world.get(cx, cy, cz + dz));
  } else {
    s1 = isSolid(world.get(cx + dx, cy, cz));
    s2 = isSolid(world.get(cx, cy + dy, cz));
  }
  const sc = isSolid(world.get(cx + dx, cy + dy, cz + dz));
  const occ = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0);
  return AO_FACTOR[occ];
}

function emitFace(
  out: MeshBuilder,
  world: World,
  x: number,
  y: number,
  z: number,
  face: FaceDef,
  tile: AtlasTile,
  topLift: number,
  withAO: boolean,
): void {
  const base = out.positions.length / 3;
  const ao = [1, 1, 1, 1];
  for (let i = 0; i < 4; i++) {
    const c = face.corners[i];
    out.positions.push(x + c[0], y + (c[1] === 1 ? topLift : 0), z + c[2]);
    out.normals.push(face.normal[0], face.normal[1], face.normal[2]);
    const sel = face.uvSel[i];
    out.uvs.push(sel[0] ? tile.u1 : tile.u0, sel[1] ? tile.v1 : tile.v0);
    if (withAO) ao[i] = cornerAO(world, x, y, z, face.normal, c);
    const v = face.brightness * ao[i];
    out.colors.push(v, v, v);
  }
  // AO flip: route the diagonal through the brighter corner pair so the
  // interpolated darkening stays local to the occluded corner.
  if (ao[0] + ao[2] >= ao[1] + ao[3]) {
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    out.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  }
}

export function meshWorld(
  world: World,
  atlas: AtlasLike,
): { opaque: MeshData; water: MeshData; lava: MeshData } {
  const opaque = new MeshBuilder();
  const waterOut = new MeshBuilder();
  const lavaOut = new MeshBuilder();
  const { sizeX, sizeY, sizeZ } = world;

  for (let y = 0; y < sizeY; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const b = world.get(x, y, z);
        if (b === Block.Air) continue;
        const isFluid = b === Block.Water || b === Block.Lava;
        for (const face of FACES) {
          const n = face.normal;
          const nb = world.get(x + n[0], y + n[1], z + n[2]);
          const tile = atlas.tiles[tileNameFor(b, face.kind)];
          if (isFluid) {
            if (nb !== Block.Air) continue;
            const lift = face.kind === 'top' ? (b === Block.Water ? 0.85 : 0.9) : 1;
            const out = b === Block.Water ? waterOut : lavaOut;
            emitFace(out, world, x, y, z, face, tile, lift, false);
          } else {
            if (isSolid(nb)) continue;
            emitFace(opaque, world, x, y, z, face, tile, 1, true);
          }
        }
      }
    }
  }

  return { opaque: opaque.build(), water: waterOut.build(), lava: lavaOut.build() };
}
