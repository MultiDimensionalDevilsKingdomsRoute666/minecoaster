import { describe, expect, test, beforeAll } from 'vitest';
import {
  WORLD_SEED,
  buildRide,
  clearanceViolations,
  type Ride,
} from '../../src/coaster/layout';
import { generateWorld, carveTunnel, Block, type World } from '../../src/world/worldgen';

let world: World;
let ride: Ride;

beforeAll(() => {
  world = generateWorld({ seed: WORLD_SEED });
  ride = buildRide(world);
});

describe('buildRide', () => {
  test('produces a closed track of sane length', () => {
    expect(ride.track.closed).toBe(true);
    expect(ride.track.length).toBeGreaterThan(350);
    expect(ride.track.length).toBeLessThan(1000);
  });

  test('is deterministic', () => {
    const again = buildRide(world);
    expect(again.track.length).toBe(ride.track.length);
    expect(again.zones).toEqual(ride.zones);
    expect(again.tunnelRange).toEqual(ride.tunnelRange);
    expect(again.loopRange).toEqual(ride.loopRange);
    expect(again.dropS).toBe(ride.dropS);
    expect(again.splashS).toBe(ride.splashS);
    expect(again.tunnelPoints).toEqual(ride.tunnelPoints);
    for (let s = 0; s < ride.track.length; s += 47) {
      expect(again.track.frameAt(s)).toEqual(ride.track.frameAt(s));
    }
  });

  test('stays inside the world bounds', () => {
    for (let s = 0; s < ride.track.length; s += 0.5) {
      const p = ride.track.posAt(s);
      expect(p.x).toBeGreaterThan(2);
      expect(p.x).toBeLessThan(world.sizeX - 2);
      expect(p.z).toBeGreaterThan(2);
      expect(p.z).toBeLessThan(world.sizeZ - 2);
      expect(p.y).toBeGreaterThan(1);
      expect(p.y).toBeLessThan(world.sizeY - 2);
    }
  });

  test('never clips terrain outside the tunnel', () => {
    const violations = clearanceViolations(ride.track, world, ride.tunnelRange, 1.4);
    expect(violations).toEqual([]);
  });

  test('independently never clips terrain (no shared helper with the builder)', () => {
    const { sStart, sEnd } = ride.tunnelRange;
    // the skipped tunnel window must stay a bounded slice of the lap, so an
    // inflated tunnelRange can't hide violations from both builder and test
    expect((sEnd - sStart + 20) / ride.track.length).toBeLessThan(0.25);
    for (let s = 0; s < ride.track.length; s += 0.25) {
      if (s >= sStart - 10 && s <= sEnd + 10) continue;
      const p = ride.track.posAt(s);
      const groundTop = world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1;
      if (world.get(Math.floor(p.x), world.waterLevel, Math.floor(p.z)) === Block.Water) {
        expect(p.y).toBeGreaterThan(world.waterLevel + 0.4);
      } else {
        expect(p.y - groundTop).toBeGreaterThan(1.3);
      }
    }
  });

  test('has a real drop: ~20+ meters of plunge after the summit', () => {
    const summitY = ride.track.posAt(ride.dropS).y;
    let minAfter = Infinity;
    for (let ds = 0; ds < 70; ds += 1) {
      minAfter = Math.min(minAfter, ride.track.posAt(ride.dropS + ds).y);
    }
    expect(summitY).toBeGreaterThan(30);
    expect(summitY - minAfter).toBeGreaterThan(18);
  });

  test('has a vertical loop (the frame goes fully upside down)', () => {
    let minNormalY = Infinity;
    for (let s = 0; s < ride.track.length; s += 0.25) {
      minNormalY = Math.min(minNormalY, ride.track.frameAt(s).normal.y);
    }
    expect(minNormalY).toBeLessThan(-0.9);
  });

  test('rides level outside the loop (gravity-referenced roll)', () => {
    const { sStart, sEnd } = ride.loopRange;
    for (let s = 0; s < ride.track.length; s += 1) {
      if (s >= sStart - 6 && s <= sEnd + 6) continue;
      const f = ride.track.frameAt(s);
      // wherever the track is not steeply pitched, the cart should be near-level
      if (Math.abs(f.tangent.y) < 0.45) {
        expect(f.normal.y).toBeGreaterThan(0.75);
      }
    }
  });

  test('roll-corrected frames stay orthonormal and seam-continuous', () => {
    for (let s = 0; s < ride.track.length; s += 7.3) {
      const f = ride.track.frameAt(s);
      for (const v of [f.tangent, f.normal, f.binormal]) {
        expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 5);
      }
      const dot = f.tangent.x * f.normal.x + f.tangent.y * f.normal.y + f.tangent.z * f.normal.z;
      expect(Math.abs(dot)).toBeLessThan(1e-5);
    }
    const a = ride.track.frameAt(0);
    const b = ride.track.frameAt(ride.track.length - 1e-7);
    expect(Math.abs(a.normal.x - b.normal.x)).toBeLessThan(0.02);
    expect(Math.abs(a.normal.y - b.normal.y)).toBeLessThan(0.02);
    expect(Math.abs(a.normal.z - b.normal.z)).toBeLessThan(0.02);
  });

  test('tunnel is long, deep, and passes near the lava pocket', () => {
    const { sStart, sEnd } = ride.tunnelRange;
    expect(sEnd - sStart).toBeGreaterThan(20);
    const mid = ride.track.posAt((sStart + sEnd) / 2);
    const surface = world.heightAt(Math.floor(mid.x), Math.floor(mid.z));
    expect(surface - mid.y).toBeGreaterThan(4);

    const lava = { x: world.sizeX * 0.78, y: 11, z: world.sizeZ * 0.3 };
    let best = Infinity;
    for (let s = sStart; s <= sEnd; s += 0.5) {
      const p = ride.track.posAt(s);
      best = Math.min(best, Math.hypot(p.x - lava.x, p.y - lava.y, p.z - lava.z));
    }
    expect(best).toBeLessThan(7);
  });

  test('splash point is low over actual water', () => {
    const p = ride.track.posAt(ride.splashS);
    expect(world.get(Math.floor(p.x), world.waterLevel, Math.floor(p.z))).toBe(Block.Water);
    expect(p.y - world.waterLevel).toBeGreaterThan(0.4);
    expect(p.y - world.waterLevel).toBeLessThan(4);
  });

  test('zones are well-formed and inside the track', () => {
    expect(ride.zones.length).toBeGreaterThanOrEqual(3);
    const sorted = [...ride.zones].sort((a, b) => a.sStart - b.sStart);
    for (const z of sorted) {
      expect(z.sStart).toBeGreaterThanOrEqual(0);
      expect(z.sStart).toBeLessThan(z.sEnd);
      expect(z.sEnd).toBeLessThanOrEqual(ride.track.length);
      expect(z.speed).toBeGreaterThan(0);
    }
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].sStart).toBeGreaterThanOrEqual(sorted[i - 1].sEnd);
    }
  });

  test('the lift zone actually climbs the mountain', () => {
    const lift = ride.zones.find(
      (z) => z.kind === 'lift' && ride.track.posAt(z.sEnd).y - ride.track.posAt(z.sStart).y > 14,
    );
    expect(lift).toBeDefined();
  });

  test('a brake zone exists late in the lap', () => {
    const brake = ride.zones.find((z) => z.kind === 'brake');
    expect(brake).toBeDefined();
    expect(brake!.sStart).toBeGreaterThan(ride.track.length * 0.6);
  });

  test('carving the tunnel clears a rideable bore', () => {
    const w2 = generateWorld({ seed: WORLD_SEED });
    carveTunnel(w2, ride.tunnelPoints, 2.8);
    for (const p of ride.tunnelPoints) {
      for (const [dx, dy, dz] of [
        [0, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const b = w2.get(
          Math.floor(p.x + dx * 0.9),
          Math.floor(p.y + dy * 0.9),
          Math.floor(p.z + dz * 0.9),
        );
        expect([Block.Air, Block.Glowstone]).toContain(b);
      }
    }
  });

  test('tunnel points cover the whole underground stretch', () => {
    expect(ride.tunnelPoints.length).toBeGreaterThan(10);
    for (const p of ride.tunnelPoints) {
      const surface = world.heightAt(Math.floor(p.x), Math.floor(p.z));
      expect(p.y).toBeLessThan(surface + 1.5);
    }
  });
});
