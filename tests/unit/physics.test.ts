import { describe, expect, test } from 'vitest';
import type { CoasterParams, Zone } from '../../src/coaster/physics';
import { CoasterSim } from '../../src/coaster/physics';

function params(overrides: Partial<CoasterParams> = {}): CoasterParams {
  return {
    trackLength: 200,
    closed: true,
    heightAt: () => 0,
    zones: [],
    ...overrides,
  };
}

describe('CoasterSim basics', () => {
  test('starts at { s: 0, v: 0, lap: 0 } and reset works', () => {
    const sim = new CoasterSim(params());
    expect(sim.state).toEqual({ s: 0, v: 0, lap: 0 });
    sim.step(1);
    sim.reset(10, 3);
    expect(sim.state).toEqual({ s: 10, v: 3, lap: 0 });
    sim.reset();
    expect(sim.state).toEqual({ s: 0, v: 0, lap: 0 });
  });

  test('flat frictional track decays v monotonically down to minSpeed', () => {
    const sim = new CoasterSim(params());
    sim.reset(0, 10);
    let prev = sim.state.v;
    for (let i = 0; i < 60; i++) {
      sim.step(0.1);
      expect(sim.state.v).toBeLessThan(prev);
      prev = sim.state.v;
    }
    expect(prev).toBeGreaterThan(0.5);
  });

  test('minSpeed clamp holds v at exactly the default 0.5 once decayed', () => {
    const sim = new CoasterSim(params());
    sim.reset(0, 1);
    sim.step(10);
    expect(sim.state.v).toBeCloseTo(0.5, 9);
    sim.step(1);
    expect(sim.state.v).toBeCloseTo(0.5, 9);
  });

  test('frictionless drag-free hills conserve v^2 + 2*g*h within 0.5%', () => {
    const g = 9.81;
    const heightAt = (s: number) => 8 + 6 * Math.sin((2 * Math.PI * s) / 200);
    const sim = new CoasterSim(params({ heightAt, friction: 0, drag: 0 }));
    sim.reset(0, 14);
    const e0 = 14 * 14 + 2 * g * heightAt(0);
    for (let i = 0; i < 400; i++) {
      sim.step(0.05);
      const e = sim.state.v ** 2 + 2 * g * heightAt(sim.state.s);
      expect(Math.abs(e - e0) / e0).toBeLessThan(0.005);
    }
  });

  test('lap increments exactly once per loop and s wraps', () => {
    const sim = new CoasterSim(params({ trackLength: 50, friction: 0, drag: 0 }));
    sim.reset(0, 10);
    for (let i = 0; i < 101; i++) sim.step(0.05); // 5.05 s -> 50.5 m
    expect(sim.state.lap).toBe(1);
    expect(sim.state.s).toBeCloseTo(0.5, 3);
    for (let i = 0; i < 100; i++) sim.step(0.05); // +5 s -> one more lap
    expect(sim.state.lap).toBe(2);
    expect(sim.state.s).toBeCloseTo(0.5, 3);
  });

  test('open track clamps at the far end with v = 0', () => {
    const sim = new CoasterSim(
      params({ trackLength: 100, closed: false, friction: 0, drag: 0 }),
    );
    sim.reset(95, 10);
    sim.step(1);
    expect(sim.state.s).toBe(100);
    expect(sim.state.v).toBe(0);
    sim.step(0.5);
    expect(sim.state.s).toBe(100);
    expect(sim.state.v).toBe(0);
    expect(sim.state.lap).toBe(0);
  });

  test('large dt and many small dt produce close end states (sub-stepping)', () => {
    const heightAt = (s: number) => 10 + 8 * Math.sin((2 * Math.PI * s) / 150);
    const a = new CoasterSim(params({ trackLength: 300, heightAt }));
    const b = new CoasterSim(params({ trackLength: 300, heightAt }));
    a.reset(0, 12);
    b.reset(0, 12);
    for (let i = 0; i < 12; i++) a.step(0.25);
    for (let i = 0; i < 100; i++) b.step(0.03); // same 3 s, different substep size
    expect(Math.abs(a.state.s - b.state.s)).toBeLessThan(0.1);
    expect(Math.abs(a.state.v - b.state.v)).toBeLessThan(0.05);
  });
});

describe('zones', () => {
  const zones: Zone[] = [
    { kind: 'lift', sStart: 10, sEnd: 20, speed: 4 },
    { kind: 'brake', sStart: 30, sEnd: 40, speed: 2 },
  ];

  test('zoneAt half-open boundaries [sStart, sEnd)', () => {
    const sim = new CoasterSim(params({ zones }));
    expect(sim.zoneAt(10)?.kind).toBe('lift');
    expect(sim.zoneAt(19.999)?.kind).toBe('lift');
    expect(sim.zoneAt(20)).toBeNull();
    expect(sim.zoneAt(30)?.kind).toBe('brake');
    expect(sim.zoneAt(40)).toBeNull();
    expect(sim.zoneAt(5)).toBeNull();
    expect(sim.zoneAt(25)).toBeNull();
  });

  test('zoneAt wraps s on closed tracks', () => {
    const sim = new CoasterSim(params({ zones }));
    expect(sim.zoneAt(200 + 15)?.kind).toBe('lift');
    expect(sim.zoneAt(200 + 25)).toBeNull();
  });

  test('lift brings v from rest up a steep grade to chain speed and holds it', () => {
    const sim = new CoasterSim(
      params({
        trackLength: 100,
        closed: false,
        heightAt: (s) => 0.4 * s, // gravity alone would pull the train backward
        friction: 0,
        drag: 0,
        zones: [{ kind: 'lift', sStart: 0, sEnd: 40, speed: 3 }],
      }),
    );
    sim.reset(0, 0);
    let prev = 0;
    for (let i = 0; i < 40; i++) {
      sim.step(0.05);
      expect(sim.state.v).toBeGreaterThanOrEqual(prev); // chain never lets it roll back
      prev = sim.state.v;
    }
    expect(sim.state.v).toBeCloseTo(3, 9); // 2 s is ample to ramp 0 -> 3 at 4 m/s^2
    expect(sim.state.s).toBeLessThan(40); // still inside the lift
    sim.step(0.5);
    expect(sim.state.v).toBeCloseTo(3, 9);
  });

  test('lift lets a faster train slow down to chain speed but not below', () => {
    const sim = new CoasterSim(
      params({
        trackLength: 100,
        closed: false,
        heightAt: (s) => 0.4 * s,
        friction: 0,
        drag: 0,
        zones: [{ kind: 'lift', sStart: 0, sEnd: 60, speed: 3 }],
      }),
    );
    sim.reset(0, 8); // gravity decelerates at ~3.9 m/s^2 on this grade
    for (let i = 0; i < 60; i++) {
      sim.step(0.05);
      expect(sim.state.v).toBeGreaterThanOrEqual(3 - 1e-9);
    }
    expect(sim.state.v).toBeCloseTo(3, 6);
  });

  test('brake decelerates at 8 m/s^2 down to target, never below', () => {
    const sim = new CoasterSim(
      params({
        friction: 0,
        drag: 0,
        zones: [{ kind: 'brake', sStart: 0, sEnd: 50, speed: 2 }],
      }),
    );
    sim.reset(0, 10);
    sim.step(0.5); // v should be ~10 - 8*0.5 = 6, still braking
    expect(sim.state.v).toBeCloseTo(6, 6);
    sim.step(1.0);
    expect(sim.state.v).toBeCloseTo(2, 9);
    sim.step(0.5);
    expect(sim.state.v).toBeCloseTo(2, 9); // holds, does not dip below target
  });

  test('brake leaves a train already below target alone (no minSpeed clamp inside)', () => {
    const sim = new CoasterSim(
      params({
        friction: 0,
        drag: 0,
        zones: [{ kind: 'brake', sStart: 0, sEnd: 50, speed: 2 }],
      }),
    );
    sim.reset(0, 0.2); // below the global minSpeed of 0.5
    sim.step(0.5);
    expect(sim.state.v).toBeCloseTo(0.2, 9);
  });

  test('launch accelerates at 12 m/s^2 up to speed', () => {
    const sim = new CoasterSim(
      params({
        friction: 0,
        drag: 0,
        zones: [{ kind: 'launch', sStart: 0, sEnd: 100, speed: 20 }],
      }),
    );
    sim.reset(0, 2);
    sim.step(1); // 2 + 12*1 = 14
    expect(sim.state.v).toBeCloseTo(14, 6);
    sim.step(1); // capped at 20
    expect(sim.state.v).toBeCloseTo(20, 9);
  });

  test('launch leaves a faster train alone', () => {
    const sim = new CoasterSim(
      params({
        friction: 0,
        drag: 0,
        zones: [{ kind: 'launch', sStart: 0, sEnd: 100, speed: 20 }],
      }),
    );
    sim.reset(0, 25);
    sim.step(1);
    expect(sim.state.v).toBeCloseTo(25, 9);
  });
});
