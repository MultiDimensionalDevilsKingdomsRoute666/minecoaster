import type { Vec3 } from '../core/vec3';
import { add, cross, dot, lerp, length, normalize, scale, sub } from '../core/vec3';

export interface TrackFrame {
  pos: Vec3;
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
}

export interface TrackOptions {
  closed?: boolean;
  samplesPerSegment?: number;
}

interface SplineSample {
  pos: Vec3;
  deriv: Vec3;
}

/** Rotate v around unit axis k by angle (Rodrigues). */
function rotateAround(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/**
 * Centripetal Catmull-Rom (Barry-Goldman) evaluation with analytic derivative.
 * Knot intervals are floored at a tiny epsilon so duplicate points cannot
 * produce division by zero.
 */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): SplineSample {
  const knot = (a: Vec3, b: Vec3) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)), 1e-6);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;

  const mix = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 =>
    add(scale(a, (tb - t) / (tb - ta)), scale(b, (t - ta) / (tb - ta)));
  const mixD = (a: Vec3, b: Vec3, da: Vec3, db: Vec3, ta: number, tb: number): Vec3 =>
    scale(
      add(sub(b, a), add(scale(da, tb - t), scale(db, t - ta))),
      1 / (tb - ta),
    );

  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const d1 = scale(sub(p1, p0), 1 / (t1 - t0));
  const d2 = scale(sub(p2, p1), 1 / (t2 - t1));
  const d3 = scale(sub(p3, p2), 1 / (t3 - t2));

  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  const db1 = mixD(a1, a2, d1, d2, t0, t2);
  const db2 = mixD(a2, a3, d2, d3, t1, t3);

  return {
    pos: mix(b1, b2, t1, t2),
    deriv: mixD(b1, b2, db1, db2, t1, t2),
  };
}

export class Track {
  readonly closed: boolean;
  readonly length: number;

  private readonly positions: Vec3[] = [];
  private readonly tangents: Vec3[] = [];
  private readonly normals: Vec3[] = [];
  private readonly arc: Float64Array;

  constructor(controlPoints: Vec3[], opts: TrackOptions = {}) {
    this.closed = opts.closed ?? true;
    const sps = Math.max(2, Math.floor(opts.samplesPerSegment ?? 48));
    const n = controlPoints.length;
    if (n < (this.closed ? 3 : 2)) {
      throw new Error(`Track needs at least ${this.closed ? 3 : 2} control points`);
    }

    const segments = this.closed ? n : n - 1;
    const cp = (i: number): Vec3 =>
      this.closed
        ? controlPoints[((i % n) + n) % n]
        : controlPoints[Math.min(Math.max(i, 0), n - 1)];

    // Dense samples: segments * sps interior points plus one terminal sample.
    // For a closed track the terminal sample duplicates sample 0 so lookups at
    // s == length need no special case.
    for (let seg = 0; seg < segments; seg++) {
      const p0 = cp(seg - 1);
      const p1 = cp(seg);
      const p2 = cp(seg + 1);
      const p3 = cp(seg + 2);
      const last = seg === segments - 1 && !this.closed ? sps : sps - 1;
      for (let j = 0; j <= last; j++) {
        const { pos, deriv } = catmullRom(p0, p1, p2, p3, j / sps);
        this.positions.push(pos);
        this.tangents.push(normalize(deriv));
      }
    }
    if (this.closed) {
      this.positions.push({ ...this.positions[0] });
      this.tangents.push({ ...this.tangents[0] });
    }

    const m = this.positions.length - 1;
    this.arc = new Float64Array(m + 1);
    for (let i = 1; i <= m; i++) {
      const a = this.positions[i - 1];
      const b = this.positions[i];
      this.arc[i] = this.arc[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    this.length = this.arc[m];

    this.buildFrames(m);
  }

  private buildFrames(m: number): void {
    const t0 = this.tangents[0];
    const ref = Math.abs(t0.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    this.normals.push(normalize(sub(ref, scale(t0, dot(ref, t0)))));

    for (let i = 1; i <= m; i++) {
      const tPrev = this.tangents[i - 1];
      const tCur = this.tangents[i];
      const axis = cross(tPrev, tCur);
      const sinA = length(axis);
      let normal = this.normals[i - 1];
      if (sinA > 1e-12) {
        normal = rotateAround(normal, scale(axis, 1 / sinA), Math.atan2(sinA, dot(tPrev, tCur)));
      }
      this.normals.push(normalize(sub(normal, scale(tCur, dot(normal, tCur)))));
    }

    if (this.closed) {
      // Transport around the loop generally returns a twisted normal; spread
      // the residual angle along the samples so the lap is seamless.
      const start = this.normals[0];
      const end = this.normals[m];
      const twist = Math.atan2(dot(t0, cross(start, end)), dot(start, end));
      for (let i = 1; i < m; i++) {
        const t = this.tangents[i];
        const n = rotateAround(this.normals[i], t, (-twist * i) / m);
        this.normals[i] = normalize(sub(n, scale(t, dot(n, t))));
      }
      this.normals[m] = { ...start };
    }
  }

  private wrapS(s: number): number {
    if (this.closed) {
      const w = s % this.length;
      return w < 0 ? w + this.length : w;
    }
    return Math.min(Math.max(s, 0), this.length);
  }

  /** Largest sample index i with arc[i] <= s (i in [0, m-1]) plus fraction. */
  private locate(s: number): { i: number; f: number } {
    const arc = this.arc;
    let lo = 0;
    let hi = arc.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arc[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = arc[lo + 1] - arc[lo];
    return { i: lo, f: span > 1e-12 ? (s - arc[lo]) / span : 0 };
  }

  posAt(s: number): Vec3 {
    const { i, f } = this.locate(this.wrapS(s));
    return lerp(this.positions[i], this.positions[i + 1], f);
  }

  frameAt(s: number): TrackFrame {
    const { i, f } = this.locate(this.wrapS(s));
    const tangent = normalize(lerp(this.tangents[i], this.tangents[i + 1], f));
    const nLerp = lerp(this.normals[i], this.normals[i + 1], f);
    const normal = normalize(sub(nLerp, scale(tangent, dot(nLerp, tangent))));
    return {
      pos: lerp(this.positions[i], this.positions[i + 1], f),
      tangent,
      normal,
      binormal: cross(tangent, normal),
    };
  }

  curvatureAt(s: number): number {
    const h = this.length / (this.arc.length - 1);
    let s0 = s - h;
    let s1 = s + h;
    if (!this.closed) {
      s0 = Math.max(0, s0);
      s1 = Math.min(this.length, s1);
      if (s1 - s0 < 1e-9) return 0;
    }
    const dT = sub(this.frameAt(s1).tangent, this.frameAt(s0).tangent);
    return length(dT) / (this.closed ? 2 * h : s1 - s0);
  }
}
