import { describe, expect, test } from 'vitest';
import { ValueNoise2D, fbm2 } from '../../src/core/noise';

describe('ValueNoise2D', () => {
  test('is deterministic for the same seed', () => {
    const a = new ValueNoise2D(123);
    const b = new ValueNoise2D(123);
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37;
      const y = i * 1.91;
      expect(a.sample(x, y)).toBe(b.sample(x, y));
    }
  });

  test('different seeds produce different fields', () => {
    const a = new ValueNoise2D(1);
    const b = new ValueNoise2D(2);
    let differing = 0;
    for (let i = 0; i < 50; i++) {
      if (a.sample(i * 0.61, i * 0.23) !== b.sample(i * 0.61, i * 0.23)) {
        differing++;
      }
    }
    expect(differing).toBeGreaterThan(40);
  });

  test('sample stays within [-1, 1]', () => {
    const noise = new ValueNoise2D(7);
    for (let i = 0; i < 2_000; i++) {
      const v = noise.sample(i * 0.173, i * 0.291);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('is continuous: nearby samples have nearby values', () => {
    const noise = new ValueNoise2D(21);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.83;
      const y = i * 0.47;
      const v0 = noise.sample(x, y);
      const v1 = noise.sample(x + 0.01, y + 0.01);
      expect(Math.abs(v1 - v0)).toBeLessThan(0.15);
    }
  });

  test('varies across space (not constant)', () => {
    const noise = new ValueNoise2D(5);
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(noise.sample(i * 1.7, i * 2.3));
    }
    expect(values.size).toBeGreaterThan(50);
  });
});

describe('fbm2', () => {
  test('is deterministic and bounded', () => {
    const noise = new ValueNoise2D(33);
    for (let i = 0; i < 500; i++) {
      const x = i * 0.11;
      const y = i * 0.07;
      const v = fbm2(noise, x, y, { octaves: 5, lacunarity: 2, gain: 0.5 });
      expect(v).toBe(fbm2(noise, x, y, { octaves: 5, lacunarity: 2, gain: 0.5 }));
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test('more octaves adds detail (differs from single octave)', () => {
    const noise = new ValueNoise2D(44);
    let differing = 0;
    for (let i = 0; i < 50; i++) {
      const x = i * 0.13;
      const y = i * 0.29;
      const one = fbm2(noise, x, y, { octaves: 1, lacunarity: 2, gain: 0.5 });
      const five = fbm2(noise, x, y, { octaves: 5, lacunarity: 2, gain: 0.5 });
      if (one !== five) differing++;
    }
    expect(differing).toBeGreaterThan(40);
  });
});
