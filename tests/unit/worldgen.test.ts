import { describe, expect, test } from 'vitest';
import { vec3 } from '../../src/core/vec3';
import {
  Block,
  FEATURES,
  carveTunnel,
  createEmptyWorld,
  generateWorld,
} from '../../src/world/worldgen';
import type { BlockId, World } from '../../src/world/worldgen';

const SEED = 1234;
const world = generateWorld({ seed: SEED });

const MX = Math.round(FEATURES.mountain.fx * world.sizeX);
const MZ = Math.round(FEATURES.mountain.fz * world.sizeZ);
const LX = Math.round(FEATURES.lake.fx * world.sizeX);
const LZ = Math.round(FEATURES.lake.fz * world.sizeZ);

function forEachBlock(
  w: World,
  fn: (x: number, y: number, z: number, b: BlockId) => void,
): void {
  for (let y = 0; y < w.sizeY; y++) {
    for (let z = 0; z < w.sizeZ; z++) {
      for (let x = 0; x < w.sizeX; x++) {
        fn(x, y, z, w.get(x, y, z));
      }
    }
  }
}

function countBlocks(w: World, id: BlockId): number {
  let n = 0;
  for (let i = 0; i < w.blocks.length; i++) if (w.blocks[i] === id) n++;
  return n;
}

/** Highest non-air, non-water, non-tree block: the terrain surface. */
function terrainTop(w: World, x: number, z: number): number {
  for (let y = w.sizeY - 1; y >= 0; y--) {
    const b = w.get(x, y, z);
    if (
      b !== Block.Air &&
      b !== Block.Water &&
      b !== Block.OakLog &&
      b !== Block.OakLeaves
    ) {
      return y;
    }
  }
  return -1;
}

function trunkBases(w: World): Array<{ x: number; y: number; z: number }> {
  const bases: Array<{ x: number; y: number; z: number }> = [];
  forEachBlock(w, (x, y, z, b) => {
    if (b === Block.OakLog && w.get(x, y - 1, z) !== Block.OakLog) {
      bases.push({ x, y, z });
    }
  });
  return bases;
}

describe('createEmptyWorld', () => {
  test('creates an all-air world with the requested dimensions', () => {
    const w = createEmptyWorld(5, 6, 7, 3);
    expect(w.sizeX).toBe(5);
    expect(w.sizeY).toBe(6);
    expect(w.sizeZ).toBe(7);
    expect(w.waterLevel).toBe(3);
    expect(w.blocks.length).toBe(5 * 6 * 7);
    expect(w.blocks.every((b) => b === Block.Air)).toBe(true);
  });

  test('waterLevel defaults to 10', () => {
    expect(createEmptyWorld(4, 4, 4).waterLevel).toBe(10);
  });

  test('get/set round-trip and the documented index layout', () => {
    const w = createEmptyWorld(5, 6, 7);
    w.set(1, 2, 3, Block.Stone);
    expect(w.get(1, 2, 3)).toBe(Block.Stone);
    expect(w.blocks[1 + 3 * 5 + 2 * 5 * 7]).toBe(Block.Stone);
  });

  test('get out of bounds returns Air, set out of bounds is a no-op', () => {
    const w = createEmptyWorld(4, 4, 4);
    expect(w.get(-1, 0, 0)).toBe(Block.Air);
    expect(w.get(0, 4, 0)).toBe(Block.Air);
    expect(w.get(0, 0, 99)).toBe(Block.Air);
    w.set(-1, 0, 0, Block.Stone);
    w.set(0, 0, 4, Block.Stone);
    expect(w.blocks.every((b) => b === Block.Air)).toBe(true);
  });

  test('heightAt skips water and returns -1 for an empty column', () => {
    const w = createEmptyWorld(4, 8, 4);
    expect(w.heightAt(1, 1)).toBe(-1);
    w.set(1, 3, 1, Block.Stone);
    w.set(1, 4, 1, Block.Water);
    expect(w.heightAt(1, 1)).toBe(3);
  });
});

describe('generateWorld', () => {
  test('uses the documented default dimensions', () => {
    expect(world.sizeX).toBe(112);
    expect(world.sizeY).toBe(48);
    expect(world.sizeZ).toBe(112);
    expect(world.waterLevel).toBe(10);
  });

  test('is deterministic: same seed gives identical blocks', () => {
    const again = generateWorld({ seed: SEED });
    expect(again.blocks).toEqual(world.blocks);
  });

  test('different seeds give different worlds', () => {
    const other = generateWorld({ seed: SEED + 1 });
    let differing = 0;
    for (let i = 0; i < world.blocks.length; i++) {
      if (world.blocks[i] !== other.blocks[i]) differing++;
    }
    expect(differing).toBeGreaterThan(1000);
  });

  test('bedrock everywhere at y=0', () => {
    for (let z = 0; z < world.sizeZ; z++) {
      for (let x = 0; x < world.sizeX; x++) {
        expect(world.get(x, 0, z)).toBe(Block.Bedrock);
      }
    }
  });

  test('water only at or below water level, never floating', () => {
    forEachBlock(world, (x, y, z, b) => {
      if (b !== Block.Water) return;
      expect(y).toBeLessThanOrEqual(world.waterLevel);
      expect(world.get(x, y - 1, z)).not.toBe(Block.Air);
      expect(world.heightAt(x, z)).toBeLessThan(world.waterLevel);
    });
  });

  test('sampled columns follow the layer recipe', () => {
    const stoneLayer = new Set<number>([
      Block.Stone,
      Block.GoldOre,
      Block.DiamondOre,
      Block.Lava,
    ]);
    for (let i = 0; i < 100; i++) {
      const x = (i * 37 + 5) % world.sizeX;
      const z = (i * 53 + 11) % world.sizeZ;
      const h = terrainTop(world, x, z);
      expect(h).toBeGreaterThanOrEqual(4);
      const top = world.get(x, h, z);
      expect([Block.Grass, Block.Sand, Block.Snow]).toContain(top);
      if (top === Block.Sand) {
        expect(h).toBeLessThanOrEqual(world.waterLevel + 1);
      } else if (top === Block.Snow) {
        expect(h).toBeGreaterThanOrEqual(28);
      } else {
        expect(h).toBeGreaterThan(world.waterLevel + 1);
        expect(h).toBeLessThan(28);
      }
      for (let y = Math.max(1, h - 3); y <= h - 1; y++) {
        expect(world.get(x, y, z)).toBe(Block.Dirt);
      }
      for (let y = 1; y <= h - 4; y++) {
        expect(stoneLayer.has(world.get(x, y, z))).toBe(true);
      }
    }
  });

  test('all three surface materials occur', () => {
    expect(countBlocks(world, Block.Grass)).toBeGreaterThan(1000);
    expect(countBlocks(world, Block.Sand)).toBeGreaterThan(50);
    expect(countBlocks(world, Block.Snow)).toBeGreaterThan(20);
  });

  test('mountain summit is tall, snow-capped, and leaves headroom', () => {
    const h = world.heightAt(MX, MZ);
    expect(h).toBeGreaterThanOrEqual(30);
    expect(h).toBeLessThanOrEqual(world.sizeY - 7);
    expect(world.get(MX, h, MZ)).toBe(Block.Snow);
  });

  test('lake is depressed below water level and filled with water', () => {
    const h = world.heightAt(LX, LZ);
    expect(h).toBeGreaterThanOrEqual(4);
    expect(h).toBeLessThanOrEqual(8);
    expect(world.get(LX, world.waterLevel, LZ)).toBe(Block.Water);
    expect(countBlocks(world, Block.Water)).toBeGreaterThan(200);
  });

  test('ore counts fall in loose bounds and diamonds stay deep', () => {
    expect(countBlocks(world, Block.GoldOre)).toBeGreaterThan(300);
    expect(countBlocks(world, Block.GoldOre)).toBeLessThan(3000);
    expect(countBlocks(world, Block.DiamondOre)).toBeGreaterThan(100);
    expect(countBlocks(world, Block.DiamondOre)).toBeLessThan(2000);
    forEachBlock(world, (_x, y, _z, b) => {
      if (b === Block.DiamondOre) expect(y).toBeLessThan(12);
    });
  });

  test('lava pocket sits inside the mountain, fully enclosed', () => {
    const lavaCount = countBlocks(world, Block.Lava);
    expect(lavaCount).toBeGreaterThan(100);
    expect(lavaCount).toBeLessThan(300);
    const enclosing = new Set<number>([
      Block.Stone,
      Block.GoldOre,
      Block.DiamondOre,
      Block.Lava,
    ]);
    forEachBlock(world, (x, y, z, b) => {
      if (b !== Block.Lava) return;
      const d = Math.hypot(x - MX, y - 9, z - MZ);
      expect(d).toBeLessThan(6);
      expect(enclosing.has(world.get(x + 1, y, z))).toBe(true);
      expect(enclosing.has(world.get(x - 1, y, z))).toBe(true);
      expect(enclosing.has(world.get(x, y + 1, z))).toBe(true);
      expect(enclosing.has(world.get(x, y - 1, z))).toBe(true);
      expect(enclosing.has(world.get(x, y, z + 1))).toBe(true);
      expect(enclosing.has(world.get(x, y, z - 1))).toBe(true);
    });
  });

  test('tree count and placement rules', () => {
    const bases = trunkBases(world);
    expect(bases.length).toBeGreaterThanOrEqual(30);
    expect(bases.length).toBeLessThanOrEqual(46);
    for (const b of bases) {
      expect([Block.Grass, Block.Dirt]).toContain(world.get(b.x, b.y - 1, b.z));
      expect(b.x).toBeGreaterThanOrEqual(3);
      expect(b.x).toBeLessThanOrEqual(world.sizeX - 4);
      expect(b.z).toBeGreaterThanOrEqual(3);
      expect(b.z).toBeLessThanOrEqual(world.sizeZ - 4);
    }
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const dx = bases[i].x - bases[j].x;
        const dz = bases[i].z - bases[j].z;
        expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(16);
      }
    }
  });

  test('trunks are 4-6 logs with leaves around the top', () => {
    const bases = trunkBases(world);
    for (const b of bases) {
      let top = b.y;
      while (world.get(b.x, top + 1, b.z) === Block.OakLog) top++;
      const len = top - b.y + 1;
      expect(len).toBeGreaterThanOrEqual(4);
      expect(len).toBeLessThanOrEqual(6);
      let leaves = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (world.get(b.x + dx, top + dy, b.z + dz) === Block.OakLeaves) {
              leaves++;
            }
          }
        }
      }
      expect(leaves).toBeGreaterThanOrEqual(3);
    }
  });

  test('every leaf block is near a log', () => {
    const logs = new Set<string>();
    forEachBlock(world, (x, y, z, b) => {
      if (b === Block.OakLog) logs.add(`${x},${y},${z}`);
    });
    forEachBlock(world, (x, y, z, b) => {
      if (b !== Block.OakLeaves) return;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dz = -2; dz <= 2 && !near; dz++) {
          for (let dx = -2; dx <= 2 && !near; dx++) {
            if (logs.has(`${x + dx},${y + dy},${z + dz}`)) near = true;
          }
        }
      }
      expect(near).toBe(true);
    });
  });

  test('generates the default world in under 2 seconds', () => {
    const start = performance.now();
    generateWorld({ seed: 99 });
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('carveTunnel', () => {
  /** Bedrock floor with a uniform stone slab from y=1..15: heightAt = 15. */
  function stoneSlab(): World {
    const w = createEmptyWorld(24, 20, 24, 5);
    for (let z = 0; z < 24; z++) {
      for (let x = 0; x < 24; x++) {
        w.set(x, 0, z, Block.Bedrock);
        for (let y = 1; y <= 15; y++) w.set(x, y, z, Block.Stone);
      }
    }
    return w;
  }

  test('clears blocks within the radius and leaves the rest untouched', () => {
    const w = stoneSlab();
    const p = vec3(12, 8, 12);
    carveTunnel(w, [p], 2.5);
    forEachBlock(w, (x, y, z, b) => {
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y, z + 0.5 - p.z);
      if (d <= 2.5) {
        expect([Block.Air, Block.Glowstone]).toContain(b);
      } else if (d > 3.5) {
        const pristine = y === 0 ? Block.Bedrock : y <= 15 ? Block.Stone : Block.Air;
        expect(b).toBe(pristine);
      }
    });
  });

  test('never removes bedrock', () => {
    const w = stoneSlab();
    carveTunnel(w, [vec3(6, 1, 6)], 3);
    for (let z = 0; z < 24; z++) {
      for (let x = 0; x < 24; x++) {
        expect(w.get(x, 0, z)).toBe(Block.Bedrock);
      }
    }
    expect(w.get(6, 2, 6)).toBe(Block.Air);
  });

  test('displaces water and lava', () => {
    const w = stoneSlab();
    w.set(12, 9, 12, Block.Water);
    w.set(13, 9, 12, Block.Lava);
    carveTunnel(w, [vec3(12.5, 9.5, 12.5)], 2.5);
    expect(w.get(12, 9, 12)).toBe(Block.Air);
    expect(w.get(13, 9, 12)).toBe(Block.Air);
  });

  test('a single deep point gets a glowstone on the tunnel floor', () => {
    const w = stoneSlab();
    // surface y=15, point y=8 is >= 3 below it
    carveTunnel(w, [vec3(12, 8, 12)], 2.5);
    expect(w.get(12, 6, 12)).toBe(Block.Glowstone);
  });

  test('a deep straight line gets sparse glowstone floor lights', () => {
    const w = stoneSlab();
    const points = [];
    for (let x = 4; x <= 19; x++) points.push(vec3(x, 6, 12));
    carveTunnel(w, [...points], 2);
    const glow: Array<{ x: number; y: number; z: number }> = [];
    forEachBlock(w, (x, y, z, b) => {
      if (b === Block.Glowstone) glow.push({ x, y, z });
    });
    expect(glow.length).toBeGreaterThanOrEqual(1);
    expect(glow.length).toBeLessThanOrEqual(4);
    for (const g of glow) {
      expect(g.z).toBe(12);
      expect(g.y).toBe(4); // lowest cleared spot below the line
    }
  });

  test('shallow points never place glowstone', () => {
    const w = stoneSlab();
    // surface is y=15, so y=14 is less than 3 below it
    carveTunnel(w, [vec3(12, 14, 12)], 2);
    forEachBlock(w, (_x, _y, _z, b) => {
      expect(b).not.toBe(Block.Glowstone);
    });
  });

  test('carving a generated world keeps it deterministic and air-filled', () => {
    const a = generateWorld({ seed: 7, sizeX: 48, sizeY: 32, sizeZ: 48 });
    const b = generateWorld({ seed: 7, sizeX: 48, sizeY: 32, sizeZ: 48 });
    const pts = [vec3(20, 6, 20), vec3(24, 6, 24), vec3(28, 6, 28)];
    carveTunnel(a, pts, 2.2);
    carveTunnel(b, pts, 2.2);
    expect(a.blocks).toEqual(b.blocks);
    expect(a.get(20, 6, 20)).toBe(Block.Air);
  });
});
