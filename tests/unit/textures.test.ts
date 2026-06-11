import { describe, expect, test } from 'vitest';
import {
  TEXTURE_NAMES,
  buildAtlas,
  generateTexture,
  type PixelTexture,
  type TextureAtlas,
  type TextureName,
} from '../../src/art/textures';

const SEED = 1337;
const TILE = 16;

const PARTICLE_NAMES = TEXTURE_NAMES.filter((n) => n.startsWith('particle_'));
const BLOCK_NAMES = TEXTURE_NAMES.filter((n) => !n.startsWith('particle_'));

function pixelAt(tex: PixelTexture, x: number, y: number): [number, number, number, number] {
  const i = (y * tex.width + x) * 4;
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2], tex.data[i + 3]];
}

function bytesEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function diffPixelCount(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let count = 0;
  for (let p = 0; p < a.length; p += 4) {
    if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || a[p + 3] !== b[p + 3]) {
      count++;
    }
  }
  return count;
}

function extractTile(atlas: TextureAtlas, name: TextureName): Uint8ClampedArray {
  const t = atlas.tiles[name];
  const x0 = Math.round(t.u0 * atlas.width);
  const y0 = Math.round(t.v0 * atlas.height);
  const out = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    const src = ((y0 + y) * atlas.width + x0) * 4;
    out.set(atlas.data.subarray(src, src + TILE * 4), y * TILE * 4);
  }
  return out;
}

describe('TEXTURE_NAMES', () => {
  test('contains all 26 unique names', () => {
    expect(TEXTURE_NAMES).toHaveLength(26);
    expect(new Set(TEXTURE_NAMES).size).toBe(26);
    expect(TEXTURE_NAMES).toContain('grass_top');
    expect(TEXTURE_NAMES).toContain('tnt_side');
    expect(TEXTURE_NAMES).toContain('particle_star');
    expect(PARTICLE_NAMES).toHaveLength(5);
    expect(BLOCK_NAMES).toHaveLength(21);
  });
});

describe('generateTexture', () => {
  test('every texture is a 16x16 RGBA buffer with matching name', () => {
    for (const name of TEXTURE_NAMES) {
      const tex = generateTexture(name, SEED);
      expect(tex.name).toBe(name);
      expect(tex.width).toBe(TILE);
      expect(tex.height).toBe(TILE);
      expect(tex.data).toBeInstanceOf(Uint8ClampedArray);
      expect(tex.data.length).toBe(TILE * TILE * 4);
    }
  });

  test('is deterministic for the same name and seed', () => {
    for (const name of TEXTURE_NAMES) {
      const a = generateTexture(name, SEED);
      const b = generateTexture(name, SEED);
      expect(bytesEqual(a.data, b.data)).toBe(true);
    }
  });

  test('different seeds change most textures', () => {
    let changed = 0;
    for (const name of TEXTURE_NAMES) {
      const a = generateTexture(name, 1);
      const b = generateTexture(name, 2);
      if (!bytesEqual(a.data, b.data)) changed++;
    }
    expect(changed).toBeGreaterThanOrEqual(20);
  });

  test('every pair of block tiles differs in at least 10% of pixels', () => {
    const textures = BLOCK_NAMES.map((name) => generateTexture(name, SEED));
    for (let i = 0; i < textures.length; i++) {
      for (let j = i + 1; j < textures.length; j++) {
        const diff = diffPixelCount(textures[i].data, textures[j].data);
        expect(diff, `${textures[i].name} vs ${textures[j].name}`).toBeGreaterThanOrEqual(
          Math.ceil(TILE * TILE * 0.1),
        );
      }
    }
  });

  test('block tiles are fully opaque except water', () => {
    for (const name of BLOCK_NAMES) {
      if (name === 'water') continue;
      const tex = generateTexture(name, SEED);
      for (let p = 3; p < tex.data.length; p += 4) {
        expect(tex.data[p], `${name} alpha`).toBe(255);
      }
    }
  });

  test('water has a single uniform alpha in 140..200', () => {
    const tex = generateTexture('water', SEED);
    const alpha = tex.data[3];
    expect(alpha).toBeGreaterThanOrEqual(140);
    expect(alpha).toBeLessThanOrEqual(200);
    for (let p = 3; p < tex.data.length; p += 4) {
      expect(tex.data[p]).toBe(alpha);
    }
  });

  test('particles have transparent corners, mostly transparent body, opaque center', () => {
    for (const name of PARTICLE_NAMES) {
      const tex = generateTexture(name, SEED);
      for (const [x, y] of [
        [0, 0],
        [15, 0],
        [0, 15],
        [15, 15],
      ] as const) {
        expect(pixelAt(tex, x, y)[3], `${name} corner ${x},${y}`).toBe(0);
      }
      let transparent = 0;
      for (let p = 3; p < tex.data.length; p += 4) if (tex.data[p] === 0) transparent++;
      expect(transparent, `${name} transparency`).toBeGreaterThanOrEqual(128);
      const centerMax = Math.max(
        pixelAt(tex, 7, 7)[3],
        pixelAt(tex, 8, 7)[3],
        pixelAt(tex, 7, 8)[3],
        pixelAt(tex, 8, 8)[3],
      );
      expect(centerMax, `${name} center`).toBeGreaterThanOrEqual(200);
    }
  });

  test('grass_top is dominated by green pixels', () => {
    const tex = generateTexture('grass_top', SEED);
    let green = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b] = pixelAt(tex, x, y);
        if (g > r && g > b) green++;
      }
    }
    expect(green).toBeGreaterThanOrEqual(TILE * TILE * 0.9);
  });

  test('grass_side has a green lip on top rows and dirt below', () => {
    const tex = generateTexture('grass_side', SEED);
    for (let y = 0; y < 3; y++) {
      let green = 0;
      for (let x = 0; x < TILE; x++) {
        const [r, g, b] = pixelAt(tex, x, y);
        if (g > r && g > b) green++;
      }
      expect(green, `row ${y}`).toBeGreaterThan(TILE / 2);
    }
    for (let y = 6; y < TILE; y++) {
      let brown = 0;
      for (let x = 0; x < TILE; x++) {
        const [r, g, b] = pixelAt(tex, x, y);
        if (r >= g && g >= b) brown++;
      }
      expect(brown, `row ${y}`).toBeGreaterThan((TILE * 3) / 4);
    }
  });

  test('glowstone is bright on average', () => {
    const tex = generateTexture('glowstone', SEED);
    let sum = 0;
    for (let p = 0; p < tex.data.length; p += 4) {
      sum += (tex.data[p] + tex.data[p + 1] + tex.data[p + 2]) / 3;
    }
    expect(sum / (TILE * TILE)).toBeGreaterThan(140);
  });

  test('lava reads hot: red-heavy and far above blue', () => {
    const tex = generateTexture('lava', SEED);
    let red = 0;
    let blue = 0;
    for (let p = 0; p < tex.data.length; p += 4) {
      red += tex.data[p];
      blue += tex.data[p + 2];
    }
    const n = TILE * TILE;
    expect(red / n).toBeGreaterThan(150);
    expect(red / n).toBeGreaterThan(blue / n + 50);
  });

  test('tnt_side has red body, a bright band, and dark lettering inside it', () => {
    const tex = generateTexture('tnt_side', SEED);
    for (const y of [0, 1, 13, 14]) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b] = pixelAt(tex, x, y);
        expect(r, `red row ${y}`).toBeGreaterThan(g + 40);
        expect(r, `red row ${y}`).toBeGreaterThan(b + 40);
      }
    }
    let bandBrightness = 0;
    for (let x = 0; x < TILE; x++) {
      const [r, g, b] = pixelAt(tex, x, 5);
      bandBrightness += (r + g + b) / 3;
    }
    expect(bandBrightness / TILE).toBeGreaterThan(180);
    let darkLetterPixels = 0;
    for (let y = 6; y <= 9; y++) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b] = pixelAt(tex, x, y);
        if (r + g + b < 200) darkLetterPixels++;
      }
    }
    expect(darkLetterPixels).toBeGreaterThanOrEqual(15);
  });
});

describe('buildAtlas', () => {
  const atlas = buildAtlas(SEED);

  test('atlas buffer matches its dimensions and is tile-aligned', () => {
    expect(atlas.data).toBeInstanceOf(Uint8ClampedArray);
    expect(atlas.data.length).toBe(atlas.width * atlas.height * 4);
    expect(atlas.width % TILE).toBe(0);
    expect(atlas.height % TILE).toBe(0);
    expect((atlas.width / TILE) * (atlas.height / TILE)).toBeGreaterThanOrEqual(26);
  });

  test('every texture has a 16x16 pixel-aligned UV rect inside [0,1]', () => {
    for (const name of TEXTURE_NAMES) {
      const t = atlas.tiles[name];
      expect(t.u0).toBeGreaterThanOrEqual(0);
      expect(t.v0).toBeGreaterThanOrEqual(0);
      expect(t.u1).toBeLessThanOrEqual(1);
      expect(t.v1).toBeLessThanOrEqual(1);
      expect(t.u0).toBeLessThan(t.u1);
      expect(t.v0).toBeLessThan(t.v1);
      const x0 = t.u0 * atlas.width;
      const y0 = t.v0 * atlas.height;
      const x1 = t.u1 * atlas.width;
      const y1 = t.v1 * atlas.height;
      expect(Number.isInteger(x0), `${name} x0`).toBe(true);
      expect(Number.isInteger(y0), `${name} y0`).toBe(true);
      expect(x1 - x0).toBe(TILE);
      expect(y1 - y0).toBe(TILE);
    }
  });

  test('tile rects never overlap', () => {
    const rects = TEXTURE_NAMES.map((name) => {
      const t = atlas.tiles[name];
      return {
        name,
        x0: Math.round(t.u0 * atlas.width),
        y0: Math.round(t.v0 * atlas.height),
        x1: Math.round(t.u1 * atlas.width),
        y1: Math.round(t.v1 * atlas.height),
      };
    });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlaps = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlaps, `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  test('atlas regions are byte-identical to generateTexture output', () => {
    const samples: TextureName[] = ['grass_top', 'water', 'tnt_side', 'glowstone', 'particle_star'];
    for (const name of samples) {
      const fromAtlas = extractTile(atlas, name);
      const direct = generateTexture(name, SEED);
      expect(bytesEqual(fromAtlas, direct.data), name).toBe(true);
    }
  });

  test('atlas is deterministic for the same seed', () => {
    const again = buildAtlas(SEED);
    expect(again.width).toBe(atlas.width);
    expect(again.height).toBe(atlas.height);
    expect(bytesEqual(again.data, atlas.data)).toBe(true);
  });
});
