import { describe, expect, test } from 'vitest';
import { meshWorld } from '../../src/world/mesher';
import type { AtlasLike, AtlasTile, MeshData } from '../../src/world/mesher';
import { Block, createEmptyWorld, generateWorld } from '../../src/world/worldgen';
import type { World } from '../../src/world/worldgen';

const TILE_NAMES = [
  'grass_top',
  'grass_side',
  'dirt',
  'stone',
  'cobblestone',
  'bedrock',
  'sand',
  'snow',
  'water',
  'lava',
  'oak_log_side',
  'oak_log_top',
  'oak_leaves',
  'oak_planks',
  'gold_ore',
  'diamond_ore',
  'glowstone',
  'tnt_side',
  'tnt_top',
  'iron_block',
] as const;

const V0 = 0.25;
const V1 = 0.45;

function makeAtlas(): AtlasLike {
  const tiles: Record<string, AtlasTile> = {};
  TILE_NAMES.forEach((name, i) => {
    const u0 = i * 0.05;
    tiles[name] = { u0, v0: V0, u1: u0 + 0.04, v1: V1 };
  });
  return { tiles };
}

const atlas = makeAtlas();

interface Quad {
  /** Index of the quad's first vertex. */
  base: number;
  pos: Array<[number, number, number]>;
  normal: [number, number, number];
  uv: Array<[number, number]>;
  /** Red channel per vertex (r === g === b). */
  color: number[];
  /** The six indices emitted for this quad. */
  indices: number[];
}

function quadCount(m: MeshData): number {
  return m.positions.length / 12;
}

function getQuads(m: MeshData): Quad[] {
  const out: Quad[] = [];
  for (let q = 0; q < quadCount(m); q++) {
    const base = q * 4;
    const pos: Array<[number, number, number]> = [];
    const uv: Array<[number, number]> = [];
    const color: number[] = [];
    for (let i = 0; i < 4; i++) {
      const v = base + i;
      pos.push([m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]);
      uv.push([m.uvs[v * 2], m.uvs[v * 2 + 1]]);
      color.push(m.colors[v * 3]);
    }
    out.push({
      base,
      pos,
      normal: [m.normals[base * 3], m.normals[base * 3 + 1], m.normals[base * 3 + 2]],
      uv,
      color,
      indices: Array.from(m.indices.slice(q * 6, q * 6 + 6)),
    });
  }
  return out;
}

function withNormal(quads: Quad[], nx: number, ny: number, nz: number): Quad[] {
  return quads.filter(
    (q) => q.normal[0] === nx && q.normal[1] === ny && q.normal[2] === nz,
  );
}

function inTile(uv: [number, number], tile: AtlasTile): boolean {
  const eps = 1e-4;
  return (
    uv[0] >= tile.u0 - eps &&
    uv[0] <= tile.u1 + eps &&
    uv[1] >= tile.v0 - eps &&
    uv[1] <= tile.v1 + eps
  );
}

function expectQuadInTile(q: Quad, name: string): void {
  for (const uv of q.uv) {
    expect(inTile(uv, atlas.tiles[name]), `uv ${uv} not in tile ${name}`).toBe(true);
  }
}

/** Geometric normal of triangle (i0,i1,i2) must agree with the stored normal. */
function expectConsistentWinding(m: MeshData): void {
  for (let t = 0; t < m.indices.length; t += 3) {
    const [i0, i1, i2] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const ax = m.positions[i1 * 3] - m.positions[i0 * 3];
    const ay = m.positions[i1 * 3 + 1] - m.positions[i0 * 3 + 1];
    const az = m.positions[i1 * 3 + 2] - m.positions[i0 * 3 + 2];
    const bx = m.positions[i2 * 3] - m.positions[i1 * 3];
    const by = m.positions[i2 * 3 + 1] - m.positions[i1 * 3 + 1];
    const bz = m.positions[i2 * 3 + 2] - m.positions[i1 * 3 + 2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const d =
      cx * m.normals[i0 * 3] + cy * m.normals[i0 * 3 + 1] + cz * m.normals[i0 * 3 + 2];
    expect(d).toBeGreaterThan(0);
  }
}

function expectValidIndices(m: MeshData): void {
  const vertexCount = m.positions.length / 3;
  expect(m.indices.length % 3).toBe(0);
  for (const i of m.indices) {
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(vertexCount);
  }
}

function singleBlockWorld(b: (typeof Block)[keyof typeof Block]): World {
  const w = createEmptyWorld(4, 4, 4);
  w.set(1, 1, 1, b);
  return w;
}

describe('meshWorld basic geometry', () => {
  test('empty world produces empty meshes', () => {
    const { opaque, water, lava } = meshWorld(createEmptyWorld(4, 4, 4), atlas);
    for (const m of [opaque, water, lava]) {
      expect(m.positions.length).toBe(0);
      expect(m.indices.length).toBe(0);
    }
  });

  test('a single stone block emits 6 faces', () => {
    const { opaque, water, lava } = meshWorld(singleBlockWorld(Block.Stone), atlas);
    expect(opaque.positions.length).toBe(24 * 3);
    expect(opaque.normals.length).toBe(24 * 3);
    expect(opaque.uvs.length).toBe(24 * 2);
    expect(opaque.colors.length).toBe(24 * 3);
    expect(opaque.indices.length).toBe(36);
    expect(water.positions.length).toBe(0);
    expect(lava.positions.length).toBe(0);
  });

  test('two stacked blocks emit 10 faces (shared face culled)', () => {
    const w = createEmptyWorld(4, 5, 4);
    w.set(1, 1, 1, Block.Stone);
    w.set(1, 2, 1, Block.Stone);
    const { opaque } = meshWorld(w, atlas);
    expect(quadCount(opaque)).toBe(10);
    expect(opaque.indices.length).toBe(60);
  });

  test('a 3x3x3 solid cube emits only its 54 outer faces', () => {
    const w = createEmptyWorld(5, 5, 5);
    for (let y = 1; y <= 3; y++) {
      for (let z = 1; z <= 3; z++) {
        for (let x = 1; x <= 3; x++) w.set(x, y, z, Block.Stone);
      }
    }
    const { opaque } = meshWorld(w, atlas);
    expect(quadCount(opaque)).toBe(54);
    expect(opaque.indices.length).toBe(54 * 6);
  });

  test('faces occupy the block cube [x,x+1]x[y,y+1]x[z,z+1]', () => {
    const { opaque } = meshWorld(singleBlockWorld(Block.Stone), atlas);
    for (let i = 0; i < opaque.positions.length; i++) {
      expect(opaque.positions[i]).toBeGreaterThanOrEqual(1);
      expect(opaque.positions[i]).toBeLessThanOrEqual(2);
    }
  });
});

describe('tile mapping and UV orientation', () => {
  test('grass uses grass_top / grass_side / dirt', () => {
    const quads = getQuads(meshWorld(singleBlockWorld(Block.Grass), atlas).opaque);
    expect(quads.length).toBe(6);
    for (const q of quads) {
      if (q.normal[1] === 1) expectQuadInTile(q, 'grass_top');
      else if (q.normal[1] === -1) expectQuadInTile(q, 'dirt');
      else expectQuadInTile(q, 'grass_side');
    }
  });

  test('side faces map v0 to the upper edge of the quad', () => {
    const quads = getQuads(meshWorld(singleBlockWorld(Block.Grass), atlas).opaque);
    const sides = quads.filter((q) => q.normal[1] === 0);
    expect(sides.length).toBe(4);
    for (const q of sides) {
      for (let i = 0; i < 4; i++) {
        if (q.pos[i][1] === 2) expect(q.uv[i][1]).toBeCloseTo(V0, 5);
        else expect(q.uv[i][1]).toBeCloseTo(V1, 5);
      }
    }
  });

  test('oak log uses oak_log_top on top/bottom and oak_log_side on sides', () => {
    const quads = getQuads(meshWorld(singleBlockWorld(Block.OakLog), atlas).opaque);
    for (const q of quads) {
      if (q.normal[1] !== 0) expectQuadInTile(q, 'oak_log_top');
      else expectQuadInTile(q, 'oak_log_side');
    }
  });

  test('tnt uses tnt_top on top/bottom and tnt_side on sides', () => {
    const quads = getQuads(meshWorld(singleBlockWorld(Block.Tnt), atlas).opaque);
    for (const q of quads) {
      if (q.normal[1] !== 0) expectQuadInTile(q, 'tnt_top');
      else expectQuadInTile(q, 'tnt_side');
    }
  });

  test('snow uses the snow tile on every face', () => {
    const quads = getQuads(meshWorld(singleBlockWorld(Block.Snow), atlas).opaque);
    for (const q of quads) expectQuadInTile(q, 'snow');
  });
});

describe('fluids', () => {
  test('a lone water block goes to the water mesh with a lowered top', () => {
    const { opaque, water } = meshWorld(singleBlockWorld(Block.Water), atlas);
    expect(opaque.positions.length).toBe(0);
    const quads = getQuads(water);
    expect(quads.length).toBe(6);
    const tops = withNormal(quads, 0, 1, 0);
    expect(tops.length).toBe(1);
    for (const p of tops[0].pos) expect(p[1]).toBeCloseTo(1.85, 5);
    for (const q of quads) expectQuadInTile(q, 'water');
  });

  test('lava top sits at y + 0.9', () => {
    const { lava } = meshWorld(singleBlockWorld(Block.Lava), atlas);
    const tops = withNormal(getQuads(lava), 0, 1, 0);
    expect(tops.length).toBe(1);
    for (const p of tops[0].pos) expect(p[1]).toBeCloseTo(1.9, 5);
  });

  test('water emits faces only against air; solids do face water', () => {
    const w = createEmptyWorld(5, 4, 4);
    w.set(1, 1, 1, Block.Water);
    w.set(2, 1, 1, Block.Stone);
    const { opaque, water } = meshWorld(w, atlas);
    expect(quadCount(water)).toBe(5); // face toward the stone is culled
    expect(quadCount(opaque)).toBe(6); // stone still shows its face into water
  });

  test('within-fluid neighbors emit nothing', () => {
    const w = createEmptyWorld(4, 5, 4);
    w.set(1, 1, 1, Block.Water);
    w.set(1, 2, 1, Block.Water);
    const { water } = meshWorld(w, atlas);
    const quads = getQuads(water);
    expect(quads.length).toBe(10);
    const tops = withNormal(quads, 0, 1, 0);
    expect(tops.length).toBe(1);
    for (const p of tops[0].pos) expect(p[1]).toBeCloseTo(2.85, 5);
    expect(withNormal(quads, 0, -1, 0).length).toBe(1);
  });
});

describe('shading', () => {
  test('face brightness: top 1.0, z sides 0.8, x sides 0.7, bottom 0.55', () => {
    const quads = getQuads(meshWorld(singleBlockWorld(Block.Stone), atlas).opaque);
    for (const q of quads) {
      const expected =
        q.normal[1] === 1 ? 1.0
        : q.normal[1] === -1 ? 0.55
        : q.normal[0] !== 0 ? 0.7
        : 0.8;
      for (const c of q.color) expect(c).toBeCloseTo(expected, 5);
    }
  });

  test('a diagonal neighbor darkens the shared top-face corner (AO)', () => {
    const w = createEmptyWorld(6, 6, 6);
    w.set(2, 2, 2, Block.Stone);
    w.set(3, 3, 3, Block.Stone);
    const quads = getQuads(meshWorld(w, atlas).opaque);
    const top = quads.find(
      (q) => q.normal[1] === 1 && q.pos.every((p) => p[1] === 3) && q.pos.some((p) => p[0] === 2),
    );
    expect(top).toBeDefined();
    if (!top) return;
    for (let i = 0; i < 4; i++) {
      const p = top.pos[i];
      if (p[0] === 3 && p[2] === 3) {
        expect(top.color[i]).toBeCloseTo(0.85, 5); // one corner occluder
      } else {
        expect(top.color[i]).toBeCloseTo(1.0, 5);
      }
    }
  });

  test('asymmetric AO flips the quad diagonal away from the dark corner', () => {
    const w = createEmptyWorld(6, 6, 6);
    w.set(2, 2, 2, Block.Stone);
    w.set(3, 3, 3, Block.Stone);
    const m = meshWorld(w, atlas).opaque;
    const quads = getQuads(m);
    const top = quads.find(
      (q) => q.normal[1] === 1 && q.pos.every((p) => p[1] === 3) && q.pos.some((p) => p[0] === 2),
    );
    expect(top).toBeDefined();
    if (!top) return;
    const darkLocal = top.pos.findIndex((p) => p[0] === 3 && p[2] === 3);
    expect(darkLocal).toBeGreaterThanOrEqual(0);
    const dark = top.base + darkLocal;
    const occurrences = top.indices.filter((i) => i === dark).length;
    expect(occurrences).toBe(1); // dark corner is isolated in a single triangle
    expectConsistentWinding(m); // flip must preserve CCW winding
  });

  test('an isolated block has no AO darkening anywhere', () => {
    const quads = getQuads(meshWorld(singleBlockWorld(Block.Stone), atlas).opaque);
    const top = withNormal(quads, 0, 1, 0)[0];
    for (const c of top.color) expect(c).toBeCloseTo(1.0, 5);
  });
});

describe('mesh integrity', () => {
  function mixedWorld(): World {
    const w = createEmptyWorld(8, 8, 8);
    w.set(1, 1, 1, Block.Grass);
    w.set(3, 1, 1, Block.Stone);
    w.set(5, 1, 1, Block.OakLog);
    w.set(1, 1, 3, Block.Tnt);
    w.set(3, 1, 3, Block.Glowstone);
    w.set(5, 1, 3, Block.IronBlock);
    w.set(1, 1, 5, Block.Planks);
    w.set(3, 1, 5, Block.GoldOre);
    w.set(5, 1, 5, Block.OakLeaves);
    w.set(6, 1, 6, Block.DiamondOre);
    w.set(2, 3, 2, Block.Sand);
    w.set(4, 3, 4, Block.Snow);
    w.set(2, 5, 3, Block.Cobblestone);
    w.set(3, 5, 2, Block.Bedrock);
    w.set(6, 3, 1, Block.Dirt);
    w.set(1, 5, 1, Block.Water);
    w.set(5, 5, 5, Block.Lava);
    return w;
  }

  test('all indices are valid and winding is consistent in every mesh', () => {
    const { opaque, water, lava } = meshWorld(mixedWorld(), atlas);
    for (const m of [opaque, water, lava]) {
      expectValidIndices(m);
      expectConsistentWinding(m);
    }
  });

  test('every quad lands fully inside exactly one atlas tile', () => {
    const { opaque, water, lava } = meshWorld(mixedWorld(), atlas);
    for (const m of [opaque, water, lava]) {
      for (const q of getQuads(m)) {
        const containing = TILE_NAMES.filter((n) =>
          q.uv.every((uv) => inTile(uv, atlas.tiles[n])),
        );
        expect(containing.length).toBe(1);
      }
    }
  });

  test('blocks at the world boundary emit faces toward out-of-bounds', () => {
    const w = createEmptyWorld(2, 2, 2);
    w.set(0, 0, 0, Block.Stone);
    const { opaque } = meshWorld(w, atlas);
    expect(quadCount(opaque)).toBe(6);
  });

  test('meshes the default generated world in under 2 seconds', () => {
    const world = generateWorld({ seed: 5 });
    const start = performance.now();
    const { opaque } = meshWorld(world, atlas);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(quadCount(opaque)).toBeGreaterThan(10000);
  });
});
