/**
 * Deterministic voxel world generator. A fixed-size island with a snow-capped
 * mountain, a lake, ores, a hidden lava pocket, and scattered oak trees — all
 * reproducible from a single seed. Pure math; no rendering concerns.
 */
import type { Vec3 } from '../core/vec3';
import { Rng, hashString } from '../core/rng';
import { ValueNoise2D, fbm2 } from '../core/noise';

export const Block = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Cobblestone: 4,
  Bedrock: 5,
  Sand: 6,
  Snow: 7,
  Water: 8,
  Lava: 9,
  OakLog: 10,
  OakLeaves: 11,
  Planks: 12,
  GoldOre: 13,
  DiamondOre: 14,
  Glowstone: 15,
  Tnt: 16,
  IronBlock: 17,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

export interface World {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  waterLevel: number;
  /** index = x + z*sizeX + y*sizeX*sizeZ */
  blocks: Uint8Array;
  get(x: number, y: number, z: number): BlockId;
  set(x: number, y: number, z: number, b: BlockId): void;
  /** y of the highest block that is neither Air nor Water; -1 if none. */
  heightAt(x: number, z: number): number;
}

export interface WorldgenOptions {
  seed: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  waterLevel?: number;
}

/** Fractional map coordinates of the two landmarks. */
export const FEATURES = {
  mountain: { fx: 0.78, fz: 0.3 },
  lake: { fx: 0.25, fz: 0.72 },
} as const;

export function createEmptyWorld(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  waterLevel = 10,
): World {
  const blocks = new Uint8Array(sizeX * sizeY * sizeZ);
  const inBounds = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < sizeX && y < sizeY && z < sizeZ;
  const get = (x: number, y: number, z: number): BlockId =>
    inBounds(x, y, z)
      ? (blocks[x + z * sizeX + y * sizeX * sizeZ] as BlockId)
      : Block.Air;
  const set = (x: number, y: number, z: number, b: BlockId): void => {
    if (inBounds(x, y, z)) blocks[x + z * sizeX + y * sizeX * sizeZ] = b;
  };
  const heightAt = (x: number, z: number): number => {
    for (let y = sizeY - 1; y >= 0; y--) {
      const b = get(x, y, z);
      if (b !== Block.Air && b !== Block.Water) return y;
    }
    return -1;
  };
  return { sizeX, sizeY, sizeZ, waterLevel, blocks, get, set, heightAt };
}

/** Smooth 1 -> 0 falloff over distance d up to radius r. */
function falloff(d: number, r: number): number {
  return d >= r ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / r);
}

const SNOW_LINE = 28;

export function generateWorld(opts: WorldgenOptions): World {
  const { seed, sizeX = 112, sizeY = 48, sizeZ = 112, waterLevel = 10 } = opts;
  const world = createEmptyWorld(sizeX, sizeY, sizeZ, waterLevel);

  const noise = new ValueNoise2D(hashString(`height:${seed}`));
  const fbmOpts = { octaves: 5, lacunarity: 2, gain: 0.5 };
  const mx = FEATURES.mountain.fx * sizeX;
  const mz = FEATURES.mountain.fz * sizeZ;
  const lx = FEATURES.lake.fx * sizeX;
  const lz = FEATURES.lake.fz * sizeZ;
  const maxH = sizeY - 7; // headroom for trees and the coaster

  const heights = new Int32Array(sizeX * sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const n = fbm2(noise, x * 0.035, z * 0.035, fbmOpts);
      let h = 12.5 + n * 5.5; // rolling base terrain in ~[7, 18]
      const mInf = falloff(Math.hypot(x - mx, z - mz), 22);
      h += mInf * (35 + n * 2 - h); // blend toward a ~33-37 summit
      const lInf = falloff(Math.hypot(x - lx, z - lz), 20);
      h += lInf * (waterLevel - 4 - h); // depress the lake bed
      heights[x + z * sizeX] = Math.max(5, Math.min(maxH, Math.round(h)));
    }
  }

  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const h = heights[x + z * sizeX];
      world.set(x, 0, z, Block.Bedrock);
      for (let y = 1; y <= h - 4; y++) world.set(x, y, z, Block.Stone);
      for (let y = Math.max(1, h - 3); y <= h - 1; y++) {
        world.set(x, y, z, Block.Dirt);
      }
      const top =
        h <= waterLevel + 1 ? Block.Sand : h >= SNOW_LINE ? Block.Snow : Block.Grass;
      world.set(x, h, z, top);
      for (let y = h + 1; y <= waterLevel; y++) world.set(x, y, z, Block.Water);
    }
  }

  const oreRng = new Rng(hashString(`ores:${seed}`));
  for (let y = 1; y <= maxH; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        if (world.get(x, y, z) !== Block.Stone) continue;
        if (oreRng.chance(0.008)) world.set(x, y, z, Block.GoldOre);
        else if (y < 12 && oreRng.chance(0.004)) {
          world.set(x, y, z, Block.DiamondOre);
        }
      }
    }
  }

  // Lava pocket buried deep under the mountain, fully enclosed by stone.
  const lavaX = Math.round(mx);
  const lavaY = 9;
  const lavaZ = Math.round(mz);
  const lavaR = 3.5;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy + dz * dz > lavaR * lavaR) continue;
        const b = world.get(lavaX + dx, lavaY + dy, lavaZ + dz);
        if (b === Block.Stone || b === Block.GoldOre || b === Block.DiamondOre) {
          world.set(lavaX + dx, lavaY + dy, lavaZ + dz, Block.Lava);
        }
      }
    }
  }

  const treeRng = new Rng(hashString(`trees:${seed}`));
  const target = treeRng.int(35, 45);
  const placed: Array<{ x: number; z: number }> = [];
  let attempts = 0;
  while (placed.length < target && attempts < 5000) {
    attempts++;
    const x = treeRng.int(3, sizeX - 4);
    const z = treeRng.int(3, sizeZ - 4);
    const h = heights[x + z * sizeX];
    if (h >= 26 || world.get(x, h, z) !== Block.Grass) continue;
    let tooClose = false;
    for (const t of placed) {
      const dx = t.x - x;
      const dz = t.z - z;
      if (dx * dx + dz * dz < 16) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    const trunk = treeRng.int(4, 6);
    if (h + trunk + 2 >= sizeY) continue;
    for (let t = 1; t <= trunk; t++) {
      if (world.get(x, h + t, z) === Block.Air) {
        world.set(x, h + t, z, Block.OakLog);
      }
    }
    const topY = h + trunk;
    for (let ly = topY - 1; ly <= topY; ly++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (dx !== 0 && dz !== 0 && treeRng.chance(0.4)) continue; // ragged corners
          if (world.get(x + dx, ly, z + dz) === Block.Air) {
            world.set(x + dx, ly, z + dz, Block.OakLeaves);
          }
        }
      }
    }
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (world.get(x + dx, topY + 1, z + dz) === Block.Air) {
        world.set(x + dx, topY + 1, z + dz, Block.OakLeaves);
      }
    }
    placed.push({ x, z });
  }

  return world;
}

/**
 * Clears everything but Bedrock within `radius` of each point (fluids are
 * displaced too). Deep stretches get a Glowstone block on the tunnel floor
 * roughly every 10th underground point. Surface heights are sampled before
 * any carving so later points are judged against the original terrain.
 */
export function carveTunnel(world: World, points: Vec3[], radius: number): void {
  const underground = points.map((p) => {
    const h = world.heightAt(Math.floor(p.x), Math.floor(p.z));
    return h >= 0 && p.y <= h - 3;
  });

  const r2 = radius * radius;
  for (const p of points) {
    const x0 = Math.max(0, Math.floor(p.x - radius));
    const y0 = Math.max(0, Math.floor(p.y - radius));
    const z0 = Math.max(0, Math.floor(p.z - radius));
    const x1 = Math.min(world.sizeX - 1, Math.ceil(p.x + radius));
    const y1 = Math.min(world.sizeY - 1, Math.ceil(p.y + radius));
    const z1 = Math.min(world.sizeZ - 1, Math.ceil(p.z + radius));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - p.y;
      for (let z = z0; z <= z1; z++) {
        const dz = z + 0.5 - p.z;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - p.x;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          if (world.get(x, y, z) === Block.Bedrock) continue;
          world.set(x, y, z, Block.Air);
        }
      }
    }
  }

  let deep = 0;
  for (let i = 0; i < points.length; i++) {
    if (!underground[i]) continue;
    if (deep % 10 === 0) {
      const p = points[i];
      const cx = Math.floor(p.x);
      const cz = Math.floor(p.z);
      const dx = cx + 0.5 - p.x;
      const dz = cz + 0.5 - p.z;
      // Lowest carved cell directly below the point = the tunnel floor.
      for (let y = Math.max(0, Math.floor(p.y - radius)); y <= Math.floor(p.y); y++) {
        const dy = y + 0.5 - p.y;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        if (world.get(cx, y, cz) !== Block.Air) continue;
        world.set(cx, y, cz, Block.Glowstone);
        break;
      }
    }
    deep++;
  }
}
