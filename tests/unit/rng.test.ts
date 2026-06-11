import { describe, expect, test } from 'vitest';
import { hashString, Rng } from '../../src/core/rng';

describe('hashString', () => {
  test('is deterministic', () => {
    expect(hashString('minecoaster')).toBe(hashString('minecoaster'));
  });

  test('different strings produce different hashes', () => {
    expect(hashString('grass_top')).not.toBe(hashString('grass_side'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  test('returns a finite integer', () => {
    const h = hashString('seed');
    expect(Number.isFinite(h)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('Rng', () => {
  test('same seed produces identical sequences', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test('different seeds produce different sequences', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  test('next() stays in [0, 1)', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('int(min, max) is inclusive of both bounds and hits them', () => {
    const rng = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = rng.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6]));
  });

  test('range(min, max) stays within bounds', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 1_000; i++) {
      const v = rng.range(-2.5, 4.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4.5);
    }
  });

  test('pick returns an element of the array', () => {
    const rng = new Rng(11);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  test('chance(0) is never true, chance(1) is always true', () => {
    const rng = new Rng(13);
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  test('output is roughly uniform', () => {
    const rng = new Rng(99);
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) sum += rng.next();
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });
});
