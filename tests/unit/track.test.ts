import { describe, expect, test } from 'vitest';
import type { Vec3 } from '../../src/core/vec3';
import { vec3, distance, dot, length, normalize, scale, sub } from '../../src/core/vec3';
import { Track } from '../../src/coaster/track';

/** 16 control points on a circle of radius r in the xz-plane. */
function circlePoints(r: number, n = 16): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push(vec3(r * Math.cos(a), 0, r * Math.sin(a)));
  }
  return pts;
}

/** Closed, non-planar layout: a circle with vertical waves (nonzero transport twist). */
function wavyLoopPoints(): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (2 * Math.PI * i) / 12;
    pts.push(vec3(5 * Math.cos(a), 1.5 * Math.sin(2 * a), 5 * Math.sin(a)));
  }
  return pts;
}

/** Open layout: straight approach, full vertical loop (with z corkscrew offset), straight exit. */
function verticalLoopPoints(): Vec3[] {
  const pts: Vec3[] = [vec3(-12, 0, 0), vec3(-8, 0, 0), vec3(-4, 0, 0)];
  for (let k = 0; k <= 8; k++) {
    const a = ((-90 + 45 * k) * Math.PI) / 180;
    pts.push(vec3(4 * Math.cos(a), 4 + 4 * Math.sin(a), (2 * k) / 8));
  }
  pts.push(vec3(4, 0, 2), vec3(8, 0, 2), vec3(12, 0, 2));
  return pts;
}

describe('Track construction and arc length', () => {
  test('is closed by default and accepts options', () => {
    expect(new Track(circlePoints(5)).closed).toBe(true);
    expect(new Track(verticalLoopPoints(), { closed: false }).closed).toBe(false);
  });

  test('unit-radius circle length is within 2% of 2*pi', () => {
    const track = new Track(circlePoints(1));
    expect(Math.abs(track.length - 2 * Math.PI) / (2 * Math.PI)).toBeLessThan(0.02);
  });

  test('curve passes through every control point (closed)', () => {
    const pts = wavyLoopPoints();
    const track = new Track(pts);
    for (const p of pts) {
      let min = Infinity;
      for (let i = 0; i < 8192; i++) {
        min = Math.min(min, distance(p, track.posAt((track.length * i) / 8192)));
      }
      expect(min).toBeLessThan(0.02);
    }
  });

  test('curve passes through every control point (open)', () => {
    const pts = verticalLoopPoints();
    const track = new Track(pts, { closed: false });
    for (const p of pts) {
      let min = Infinity;
      for (let i = 0; i <= 8192; i++) {
        min = Math.min(min, distance(p, track.posAt((track.length * i) / 8192)));
      }
      expect(min).toBeLessThan(0.02);
    }
  });

  test('arc-length parameterization: equal s steps move equal distances within 5%', () => {
    const track = new Track(circlePoints(1));
    const step = track.length / 100;
    for (let i = 0; i < 100; i++) {
      const d = distance(track.posAt(i * step), track.posAt((i + 1) * step));
      expect(d).toBeGreaterThan(step * 0.95);
      expect(d).toBeLessThan(step * 1.05);
    }
  });
});

describe('Track sampling semantics', () => {
  test('closed track wraps s', () => {
    const track = new Track(circlePoints(5));
    const L = track.length;
    expect(distance(track.posAt(L + 2), track.posAt(2))).toBeLessThan(1e-9);
    expect(distance(track.posAt(-1), track.posAt(L - 1))).toBeLessThan(1e-9);
    const fa = track.frameAt(L + 2);
    const fb = track.frameAt(2);
    expect(distance(fa.tangent, fb.tangent)).toBeLessThan(1e-9);
    expect(distance(fa.normal, fb.normal)).toBeLessThan(1e-9);
  });

  test('open track clamps s at both ends', () => {
    const pts = verticalLoopPoints();
    const track = new Track(pts, { closed: false });
    const L = track.length;
    expect(distance(track.posAt(-5), track.posAt(0))).toBeLessThan(1e-9);
    expect(distance(track.posAt(L + 10), track.posAt(L))).toBeLessThan(1e-9);
    expect(distance(track.posAt(0), pts[0])).toBeLessThan(1e-6);
    expect(distance(track.posAt(L), pts[pts.length - 1])).toBeLessThan(1e-6);
  });
});

describe('Track frames', () => {
  test('frames are orthonormal at 200 samples through a vertical loop', () => {
    const track = new Track(verticalLoopPoints(), { closed: false });
    for (let i = 0; i <= 200; i++) {
      const f = track.frameAt((track.length * i) / 200);
      expect(Math.abs(length(f.tangent) - 1)).toBeLessThan(1e-6);
      expect(Math.abs(length(f.normal) - 1)).toBeLessThan(1e-6);
      expect(Math.abs(length(f.binormal) - 1)).toBeLessThan(1e-6);
      expect(Math.abs(dot(f.tangent, f.normal))).toBeLessThan(1e-6);
      expect(Math.abs(dot(f.tangent, f.binormal))).toBeLessThan(1e-6);
      expect(Math.abs(dot(f.normal, f.binormal))).toBeLessThan(1e-6);
    }
  });

  test('frames never flip through the vertical loop (continuity)', () => {
    const track = new Track(verticalLoopPoints(), { closed: false });
    let prev = track.frameAt(0);
    for (let i = 1; i <= 400; i++) {
      const f = track.frameAt((track.length * i) / 400);
      expect(dot(prev.normal, f.normal)).toBeGreaterThan(0.9);
      expect(dot(prev.tangent, f.tangent)).toBeGreaterThan(0.9);
      prev = f;
    }
  });

  test('frames are orthonormal and continuous on a closed wavy loop', () => {
    const track = new Track(wavyLoopPoints());
    let prev = track.frameAt(0);
    for (let i = 1; i <= 400; i++) {
      const f = track.frameAt((track.length * i) / 400);
      expect(Math.abs(length(f.normal) - 1)).toBeLessThan(1e-6);
      expect(Math.abs(dot(f.tangent, f.normal))).toBeLessThan(1e-6);
      expect(dot(prev.normal, f.normal)).toBeGreaterThan(0.9);
      prev = f;
    }
  });

  test('closed-track seam: frameAt(0) matches frameAt(length - epsilon)', () => {
    const track = new Track(wavyLoopPoints());
    const a = track.frameAt(0);
    const b = track.frameAt(track.length - 1e-9);
    for (const key of ['pos', 'tangent', 'normal', 'binormal'] as const) {
      expect(distance(a[key], b[key])).toBeLessThan(1e-3);
    }
  });

  test('tangent matches central difference of posAt', () => {
    const track = new Track(circlePoints(5));
    const h = 0.05;
    for (let i = 0; i < 20; i++) {
      const s = (track.length * i) / 20 + 0.3;
      const fd = normalize(scale(sub(track.posAt(s + h), track.posAt(s - h)), 1 / (2 * h)));
      expect(dot(fd, track.frameAt(s).tangent)).toBeGreaterThan(0.999);
    }
  });

  test('tangent matches central difference on the open vertical loop', () => {
    const track = new Track(verticalLoopPoints(), { closed: false });
    const h = 0.05;
    for (let i = 1; i < 20; i++) {
      const s = (track.length * i) / 20;
      const fd = normalize(sub(track.posAt(s + h), track.posAt(s - h)));
      expect(dot(fd, track.frameAt(s).tangent)).toBeGreaterThan(0.999);
    }
  });
});

describe('Track curvature', () => {
  test('curvature of a unit circle is ~1 within 10%', () => {
    // 24 points: the CR fit through 16 points genuinely over-curves by ~11%
    // near joins, so 16 would test the spline's fit error, not curvatureAt.
    const track = new Track(circlePoints(1, 24));
    for (let i = 0; i < 20; i++) {
      const k = track.curvatureAt((track.length * i) / 20);
      expect(k).toBeGreaterThan(0.9);
      expect(k).toBeLessThan(1.1);
    }
  });

  test('curvature is non-negative and near zero on a straight run', () => {
    const track = new Track(verticalLoopPoints(), { closed: false });
    // s = 2 lies inside the straight approach (-12..-4 along x).
    const k = track.curvatureAt(2);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThan(0.05);
  });
});
