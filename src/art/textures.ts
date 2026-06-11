/**
 * Procedural 16x16 pixel-art textures. The game ships zero image assets:
 * every tile is painted here from a seed, so the whole art style is
 * reproducible and tweakable in code. Buffers are RGBA row-major with
 * row 0 as the visual TOP of the tile.
 */
import { Rng, hashString } from '../core/rng';
import { ValueNoise2D, fbm2 } from '../core/noise';

export type TextureName =
  | 'grass_top'
  | 'grass_side'
  | 'dirt'
  | 'stone'
  | 'cobblestone'
  | 'bedrock'
  | 'sand'
  | 'snow'
  | 'water'
  | 'lava'
  | 'oak_log_side'
  | 'oak_log_top'
  | 'oak_leaves'
  | 'oak_planks'
  | 'gold_ore'
  | 'diamond_ore'
  | 'glowstone'
  | 'tnt_side'
  | 'tnt_top'
  | 'iron_block'
  | 'rail'
  | 'particle_spark'
  | 'particle_splash'
  | 'particle_ember'
  | 'particle_firework'
  | 'particle_star';

export const TEXTURE_NAMES: readonly TextureName[] = [
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
  'rail',
  'particle_spark',
  'particle_splash',
  'particle_ember',
  'particle_firework',
  'particle_star',
];

export interface PixelTexture {
  name: TextureName;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface AtlasTile {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface TextureAtlas {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  tiles: Record<TextureName, AtlasTile>;
}

const SIZE = 16;

type Color = readonly [number, number, number];
type Painter = (data: Uint8ClampedArray, rng: Rng) => void;

// ---------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------

const GRASS_RAMP: readonly Color[] = [
  [86, 140, 48],
  [98, 156, 54],
  [109, 170, 62],
  [121, 184, 72],
];
const DIRT_RAMP: readonly Color[] = [
  [112, 80, 55],
  [127, 92, 64],
  [140, 102, 72],
  [152, 112, 80],
];
const STONE_RAMP: readonly Color[] = [
  [100, 100, 100],
  [112, 112, 112],
  [125, 125, 125],
  [138, 138, 138],
];
const COBBLE_RAMP: readonly Color[] = [
  [108, 108, 108],
  [121, 121, 121],
  [133, 133, 133],
  [146, 146, 146],
];
const BEDROCK_RAMP: readonly Color[] = [
  [31, 31, 31],
  [55, 55, 55],
  [84, 84, 84],
  [115, 115, 115],
];
const SAND_RAMP: readonly Color[] = [
  [199, 184, 148],
  [210, 196, 159],
  [220, 207, 169],
  [229, 217, 180],
];
const SNOW_RAMP: readonly Color[] = [
  [238, 242, 247],
  [247, 249, 252],
  [253, 253, 255],
];
const WATER_RAMP: readonly Color[] = [
  [38, 72, 180],
  [46, 86, 198],
  [54, 99, 214],
  [62, 112, 228],
];
const BARK_RAMP: readonly Color[] = [
  [88, 66, 40],
  [97, 73, 45],
  [107, 81, 51],
  [117, 90, 58],
];
const LEAF_RAMP: readonly Color[] = [
  [33, 66, 16],
  [42, 84, 21],
  [50, 100, 25],
  [58, 116, 30],
];
const GOLD_RAMP: readonly Color[] = [
  [255, 237, 104],
  [250, 216, 70],
  [224, 180, 38],
];
const DIAMOND_RAMP: readonly Color[] = [
  [140, 237, 229],
  [101, 221, 210],
  [70, 190, 186],
];
const GLOW_RAMP: readonly Color[] = [
  [210, 150, 72],
  [234, 180, 96],
  [252, 217, 134],
  [255, 241, 179],
];
const TNT_RED_RAMP: readonly Color[] = [
  [190, 48, 18],
  [206, 57, 21],
  [219, 68, 26],
  [228, 80, 32],
];
const TNT_WHITE_RAMP: readonly Color[] = [
  [219, 219, 219],
  [229, 229, 229],
  [240, 240, 240],
];
const GRAVEL_RAMP: readonly Color[] = [
  [110, 100, 90],
  [120, 110, 100],
  [132, 122, 110],
];

// 3x4 "T", 4x4 "N", 3x4 "T" with single-column gaps, 12px wide.
const TNT_GLYPH = ['###.#..#.###', '.#..##.#..#.', '.#..#.##..#.', '.#..#..#..#.'] as const;

// ---------------------------------------------------------------------------
// paint helpers
// ---------------------------------------------------------------------------

function put(data: Uint8ClampedArray, x: number, y: number, c: Color, a = 255): void {
  const i = (y * SIZE + x) * 4;
  data[i] = c[0];
  data[i + 1] = c[1];
  data[i + 2] = c[2];
  data[i + 3] = a;
}

/** Brightness-only jitter so channel ordering (e.g. green dominance) survives. */
function putJitter(
  data: Uint8ClampedArray,
  rng: Rng,
  x: number,
  y: number,
  c: Color,
  amt: number,
  a = 255,
): void {
  const d = rng.int(-amt, amt);
  put(data, x, y, [c[0] + d, c[1] + d, c[2] + d], a);
}

function mix(a: Color, b: Color, t: number): Color {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Per-pixel random palette pick — fine sandy/grainy noise. */
function speckle(
  data: Uint8ClampedArray,
  rng: Rng,
  ramp: readonly Color[],
  amt: number,
  a = 255,
): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      putJitter(data, rng, x, y, rng.pick(ramp), amt, a);
    }
  }
}

/** Value-noise quantized into the palette — soft blotchy patches. */
function blotch(
  data: Uint8ClampedArray,
  rng: Rng,
  ramp: readonly Color[],
  scale: number,
  amt: number,
  a = 255,
): void {
  const noise = new ValueNoise2D(rng.int(0, 0x7fffffff));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = (noise.sample(x * scale, y * scale) + 1) / 2;
      let idx = Math.min(ramp.length - 1, Math.max(0, Math.floor(v * ramp.length)));
      if (rng.chance(0.12)) {
        idx = Math.min(ramp.length - 1, Math.max(0, idx + (rng.chance(0.5) ? 1 : -1)));
      }
      putJitter(data, rng, x, y, ramp[idx], amt, a);
    }
  }
}

function dirtBase(data: Uint8ClampedArray, rng: Rng): void {
  speckle(data, rng, DIRT_RAMP, 6);
  for (let i = 0; i < 7; i++) {
    putJitter(data, rng, rng.int(0, 15), rng.int(0, 15), [92, 64, 42], 5);
  }
}

function stoneBase(data: Uint8ClampedArray, rng: Rng): void {
  blotch(data, rng, STONE_RAMP, 0.45, 5);
}

/** Stone base with small nugget clusters punched in. */
function orePainter(ramp: readonly Color[]): Painter {
  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
  ] as const;
  return (data, rng) => {
    stoneBase(data, rng);
    for (let i = 0; i < 4; i++) {
      const cx = rng.int(2, 13);
      const cy = rng.int(2, 13);
      put(data, cx, cy, rng.pick(ramp));
      for (const [ox, oy] of offsets) {
        if (rng.chance(0.55)) putJitter(data, rng, cx + ox, cy + oy, rng.pick(ramp), 6);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// painters
// ---------------------------------------------------------------------------

const PAINTERS: Record<TextureName, Painter> = {
  grass_top: (data, rng) => {
    blotch(data, rng, GRASS_RAMP, 0.5, 5);
  },

  grass_side: (data, rng) => {
    dirtBase(data, rng);
    let shallow = 0; // cap ragged-lip dips so the top 3 rows stay clearly green
    for (let x = 0; x < SIZE; x++) {
      let depth: number = rng.pick([2, 3, 3, 3, 4] as const);
      if (depth === 2 && shallow >= 3) depth = 3;
      if (depth === 2) shallow++;
      for (let y = 0; y < depth; y++) {
        // darker green at the lip's ragged bottom edge
        putJitter(data, rng, x, y, y === depth - 1 ? [76, 124, 42] : rng.pick(GRASS_RAMP), 5);
      }
    }
  },

  dirt: dirtBase,

  stone: stoneBase,

  cobblestone: (data, rng) => {
    // toroidal Voronoi: stones separated by dark mortar, seamless when tiled
    const sites: { x: number; y: number; c: Color }[] = [];
    for (let i = 0; i < 8; i++) {
      sites.push({ x: rng.range(0, SIZE), y: rng.range(0, SIZE), c: rng.pick(COBBLE_RAMP) });
    }
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let d1 = Infinity;
        let d2 = Infinity;
        let c: Color = COBBLE_RAMP[0];
        for (const s of sites) {
          const dx = Math.min(Math.abs(x + 0.5 - s.x), SIZE - Math.abs(x + 0.5 - s.x));
          const dy = Math.min(Math.abs(y + 0.5 - s.y), SIZE - Math.abs(y + 0.5 - s.y));
          const d = Math.hypot(dx, dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            c = s.c;
          } else if (d < d2) {
            d2 = d;
          }
        }
        if (d2 - d1 < 1.5) putJitter(data, rng, x, y, [70, 70, 70], 6);
        else putJitter(data, rng, x, y, c, 7);
      }
    }
  },

  bedrock: (data, rng) => {
    blotch(data, rng, BEDROCK_RAMP, 0.55, 6);
  },

  sand: (data, rng) => {
    speckle(data, rng, SAND_RAMP, 4);
  },

  snow: (data, rng) => {
    speckle(data, rng, SNOW_RAMP, 3);
  },

  water: (data, rng) => {
    const alpha = rng.int(150, 190);
    const noise = new ValueNoise2D(rng.int(0, 0x7fffffff));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // stretched noise reads as horizontal ripple bands
        const v = (noise.sample(x * 0.18, y * 0.55) + 1) / 2;
        const idx = Math.min(3, Math.max(0, Math.floor(v * 4)));
        putJitter(data, rng, x, y, WATER_RAMP[idx], 4, alpha);
      }
    }
  },

  lava: (data, rng) => {
    const noise = new ValueNoise2D(rng.int(0, 0x7fffffff));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = fbm2(noise, x * 0.32, y * 0.32, { octaves: 3, lacunarity: 2, gain: 0.55 });
        const m = Math.abs(v);
        // ridges of the fbm field become dark crust veins
        if (m < 0.1) putJitter(data, rng, x, y, [126, 38, 12], 8);
        else {
          const t = Math.min(1, (m - 0.1) / 0.6);
          putJitter(data, rng, x, y, mix([240, 116, 18], [255, 228, 92], t), 8);
        }
      }
    }
  },

  oak_log_side: (data, rng) => {
    // vertical bark streaks: shade index random-walks across columns
    let idx = rng.int(0, BARK_RAMP.length - 1);
    const colIdx: number[] = [];
    for (let x = 0; x < SIZE; x++) {
      idx = Math.min(BARK_RAMP.length - 1, Math.max(0, idx + rng.int(-1, 1)));
      colIdx.push(idx);
    }
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const crack = rng.chance(0.06);
        putJitter(data, rng, x, y, crack ? [64, 47, 29] : BARK_RAMP[colIdx[x]], 6);
      }
    }
  },

  oak_log_top: (data, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // Chebyshev distance gives square growth rings
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d > 6) putJitter(data, rng, x, y, rng.pick(BARK_RAMP), 6);
        else if (d < 1) putJitter(data, rng, x, y, [128, 99, 53], 5);
        else {
          const ring: Color = Math.floor(d) % 2 === 0 ? [180, 146, 88] : [148, 117, 66];
          putJitter(data, rng, x, y, ring, 5);
        }
      }
    }
  },

  oak_leaves: (data, rng) => {
    speckle(data, rng, LEAF_RAMP, 5);
    for (let i = 0; i < 12; i++) {
      putJitter(data, rng, rng.int(0, 15), rng.int(0, 15), [22, 44, 11], 4);
    }
  },

  oak_planks: (data, rng) => {
    const base: Color = [162, 131, 79];
    const line: Color = [97, 75, 46];
    const plankDelta: number[] = [];
    const seamX: number[] = [];
    for (let p = 0; p < 4; p++) {
      plankDelta.push(rng.int(-10, 8));
      seamX.push((p * 5 + rng.int(0, 3)) % SIZE);
    }
    for (let y = 0; y < SIZE; y++) {
      const plank = y >> 2;
      const isGap = (y & 3) === 3;
      for (let x = 0; x < SIZE; x++) {
        if (isGap || x === seamX[plank]) {
          putJitter(data, rng, x, y, line, 4);
        } else {
          const d = plankDelta[plank] + rng.int(-7, 4);
          put(data, x, y, [base[0] + d, base[1] + d, base[2] + d]);
        }
      }
    }
  },

  gold_ore: orePainter(GOLD_RAMP),

  diamond_ore: orePainter(DIAMOND_RAMP),

  glowstone: (data, rng) => {
    blotch(data, rng, GLOW_RAMP, 0.55, 6);
    for (let i = 0; i < 10; i++) {
      put(data, rng.int(0, 15), rng.int(0, 15), [255, 248, 196]);
    }
  },

  tnt_side: (data, rng) => {
    for (let y = 0; y < SIZE; y++) {
      const band = y >= 5 && y <= 10;
      for (let x = 0; x < SIZE; x++) {
        putJitter(data, rng, x, y, rng.pick(band ? TNT_WHITE_RAMP : TNT_RED_RAMP), 4);
      }
    }
    for (let ly = 0; ly < TNT_GLYPH.length; ly++) {
      for (let lx = 0; lx < TNT_GLYPH[ly].length; lx++) {
        if (TNT_GLYPH[ly][lx] === '#') put(data, 2 + lx, 6 + ly, [38, 31, 28]);
      }
    }
  },

  tnt_top: (data, rng) => {
    speckle(data, rng, TNT_RED_RAMP, 4);
    for (let y = 4; y <= 11; y++) {
      for (let x = 4; x <= 11; x++) {
        putJitter(data, rng, x, y, rng.pick(SAND_RAMP), 4);
      }
    }
    for (let y = 7; y <= 8; y++) {
      for (let x = 7; x <= 8; x++) {
        putJitter(data, rng, x, y, [58, 44, 36], 4);
      }
    }
  },

  iron_block: (data, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let c = 219 + rng.int(-3, 3);
        if (x === 0 || y === 0) c += 18; // beveled highlight
        if (x === 15 || y === 15) c -= 28; // beveled shadow
        put(data, x, y, [c, c, c + 2]);
      }
    }
  },

  rail: (data, rng) => {
    speckle(data, rng, GRAVEL_RAMP, 6);
    for (const ty of [1, 7, 13]) {
      for (let y = ty; y < ty + 2; y++) {
        for (let x = 0; x < SIZE; x++) {
          putJitter(data, rng, x, y, [134, 101, 62], 8);
        }
      }
    }
    for (let y = 0; y < SIZE; y++) {
      putJitter(data, rng, 2, y, [108, 108, 112], 5);
      putJitter(data, rng, 3, y, [168, 168, 174], 5);
      putJitter(data, rng, 12, y, [168, 168, 174], 5);
      putJitter(data, rng, 13, y, [108, 108, 112], 5);
    }
  },

  particle_spark: (data, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const r = 5.4 + rng.range(-0.5, 0.5);
        if (d >= r) continue;
        const t = d / r;
        const a = t < 0.35 ? 255 : Math.round(255 * (1 - (t - 0.35) / 0.65));
        if (a < 20) continue;
        put(data, x, y, mix([255, 255, 225], [255, 196, 64], t), a);
      }
    }
  },

  particle_splash: (data, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot(x - 7.5, y - 9);
        const edge = 4.2 + rng.range(-0.4, 0.4);
        if (d >= edge) continue;
        const t = d / 4.4;
        const a = t < 0.45 ? 235 : Math.round(235 * (1 - (t - 0.45) / 0.55));
        if (a < 25) continue;
        put(data, x, y, mix([205, 228, 255], [68, 114, 228], t), a);
      }
    }
    // spray droplets thrown up above the blob
    for (let i = 0; i < 4; i++) {
      put(data, rng.int(3, 12), rng.int(2, 4), [160, 200, 255], 190);
    }
  },

  particle_ember: (data, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const r = 3.4 + rng.range(0, 1.2); // ragged glowing edge
        if (d >= r) continue;
        const t = d / 4.6;
        const c =
          t < 0.3
            ? ([255, 232, 128] as const)
            : mix([255, 150, 46], [180, 48, 12], (t - 0.3) / 0.7);
        const a = t < 0.5 ? 255 : Math.round(255 * (1 - (t - 0.5) / 0.5));
        if (a < 25) continue;
        put(data, x, y, c, a);
      }
    }
  },

  particle_firework: (data, rng) => {
    const colors: readonly Color[] = [
      [255, 96, 96],
      [255, 220, 96],
      [112, 196, 255],
      [168, 255, 128],
      [235, 140, 255],
    ];
    for (let i = 0; i < 14; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(2.2, 5.6);
      const px = Math.round(7.5 + Math.cos(ang) * dist);
      const py = Math.round(7.5 + Math.sin(ang) * dist);
      const c = rng.pick(colors);
      put(data, px, py, c, 235);
      const tx = Math.round(7.5 + Math.cos(ang) * (dist - 1.2));
      const ty = Math.round(7.5 + Math.sin(ang) * (dist - 1.2));
      if (data[(ty * SIZE + tx) * 4 + 3] === 0) put(data, tx, ty, c, 130);
    }
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (Math.hypot(x - 7.5, y - 7.5) < 1.9) put(data, x, y, [255, 255, 235]);
      }
    }
  },

  particle_star: (data, rng) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const ax = Math.abs(x - 7.5);
        const ay = Math.abs(y - 7.5);
        let s = 0;
        if (ay < 1) s = Math.max(s, 1 - ax / 8.2);
        if (ax < 1) s = Math.max(s, 1 - ay / 8.2);
        if (ax < 2 && ay < 2) s = Math.max(s, 1 - Math.max(ax, ay) / 3.2);
        if (Math.abs(ax - ay) < 0.8 && ax < 4) s = Math.max(s, 0.65 * (1 - ax / 4.6));
        const j = rng.int(-8, 8);
        if (s <= 0.04) continue;
        const c = mix([255, 252, 224], [255, 196, 64], 1 - Math.min(1, s));
        put(data, x, y, [c[0] + j, c[1] + j, c[2] + j], Math.round(Math.min(1, s) * 255));
      }
    }
  },
};

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function generateTexture(name: TextureName, seed: number): PixelTexture {
  const rng = new Rng((hashString(name) ^ seed) >>> 0);
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  PAINTERS[name](data, rng);
  return { name, width: SIZE, height: SIZE, data };
}

export function buildAtlas(seed: number): TextureAtlas {
  const cols = 8;
  const rows = Math.ceil(TEXTURE_NAMES.length / cols);
  const width = cols * SIZE;
  const height = rows * SIZE;
  const data = new Uint8ClampedArray(width * height * 4);
  const tiles = {} as Record<TextureName, AtlasTile>;
  TEXTURE_NAMES.forEach((name, i) => {
    const px = (i % cols) * SIZE;
    const py = Math.floor(i / cols) * SIZE;
    const tex = generateTexture(name, seed);
    for (let y = 0; y < SIZE; y++) {
      data.set(tex.data.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), ((py + y) * width + px) * 4);
    }
    tiles[name] = {
      u0: px / width,
      v0: py / height,
      u1: (px + SIZE) / width,
      v1: (py + SIZE) / height,
    };
  });
  return { width, height, data, tiles };
}
