/**
 * Seeded 2D value noise with smooth interpolation, plus fractal Brownian
 * motion. Used for terrain heightmaps and texture grain.
 */
import { Rng } from './rng';

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export class ValueNoise2D {
  private perm: Uint8Array;
  private values: Float64Array;

  constructor(seed: number) {
    const rng = new Rng(seed);
    this.perm = new Uint8Array(512);
    this.values = new Float64Array(256);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.values[i] = rng.range(-1, 1);
  }

  private lattice(ix: number, iy: number): number {
    return this.values[this.perm[(this.perm[ix & 255] + iy) & 255]];
  }

  /** Smooth noise value in [-1, 1]. */
  sample(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = smoothstep(fx);
    const sy = smoothstep(fy);
    const v00 = this.lattice(ix, iy);
    const v10 = this.lattice(ix + 1, iy);
    const v01 = this.lattice(ix, iy + 1);
    const v11 = this.lattice(ix + 1, iy + 1);
    const top = v00 + (v10 - v00) * sx;
    const bottom = v01 + (v11 - v01) * sx;
    return top + (bottom - top) * sy;
  }
}

export interface FbmOptions {
  octaves: number;
  lacunarity: number;
  gain: number;
}

/** Fractal Brownian motion over a noise field, normalized to [-1, 1]. */
export function fbm2(
  noise: ValueNoise2D,
  x: number,
  y: number,
  { octaves, lacunarity, gain }: FbmOptions,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * noise.sample(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}
