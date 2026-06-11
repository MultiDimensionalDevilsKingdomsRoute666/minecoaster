/**
 * The ride itself: a hand-designed circuit anchored to the generated terrain.
 * Waypoints carry either a terrain-relative height (dy) or an absolute one
 * (tunnel bore, lake skim, loop). After splining, a relaxation pass raises
 * any control point whose stretch of track would clip terrain — so the layout
 * survives terrain detail without hand-tuning every block.
 */
import { vec3, cross, normalize, dot as vdot, type Vec3 } from '../core/vec3';
import { hashString } from '../core/rng';
import { Track, type TrackFrame } from './track';
import type { Zone } from './physics';
import { Block, type World } from '../world/worldgen';

export const WORLD_SEED = hashString('minecoaster-v1');

/** Structural track interface so consumers work with Track or RideTrack. */
export interface TrackLike {
  readonly closed: boolean;
  readonly length: number;
  posAt(s: number): Vec3;
  frameAt(s: number): TrackFrame;
  curvatureAt(s: number): number;
}

export interface Ride {
  track: TrackLike;
  zones: Zone[];
  /** dense underground samples handed to carveTunnel */
  tunnelPoints: Vec3[];
  tunnelRange: { sStart: number; sEnd: number };
  loopRange: { sStart: number; sEnd: number };
  dropS: number;
  splashS: number;
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  // Rodrigues rotation
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = axis;
  const kxv = cross(k, v);
  const kdv = vdot(k, v);
  return {
    x: v.x * c + kxv.x * s + k.x * kdv * (1 - c),
    y: v.y * c + kxv.y * s + k.y * kdv * (1 - c),
    z: v.z * c + kxv.z * s + k.z * kdv * (1 - c),
  };
}

function wrapToPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Parallel-transport frames accumulate geometric roll (holonomy) around a 3D
 * circuit, so the cart would ride visibly banked on straights. RideTrack
 * post-processes the frames to be gravity-referenced — the cart rides level
 * wherever the track is horizontal-ish — while leaving the marked inversion
 * (the loop) free to roll all the way over.
 */
export class RideTrack implements TrackLike {
  readonly closed: boolean;
  readonly length: number;
  private alpha: Float64Array;
  private step: number;
  private base: Track;

  constructor(base: Track, freeRanges: { sStart: number; sEnd: number }[], margin = 4) {
    this.base = base;
    this.closed = base.closed;
    this.length = base.length;
    this.step = 0.5;
    const n = Math.max(4, Math.ceil(base.length / this.step));
    this.step = base.length / n;
    const err = new Float64Array(n).fill(Number.NaN);

    for (let i = 0; i < n; i++) {
      const s = i * this.step;
      const inFree = freeRanges.some((r) => s >= r.sStart - margin && s <= r.sEnd + margin);
      const f = base.frameAt(s);
      if (inFree || Math.abs(f.tangent.y) > 0.92) continue;
      const ideal = normalize({
        x: -f.tangent.x * f.tangent.y,
        y: 1 - f.tangent.y * f.tangent.y,
        z: -f.tangent.z * f.tangent.y,
      });
      // signed angle from the PTF normal to the level normal, around the tangent
      const sinA = vdot(f.tangent, cross(f.normal, ideal));
      const cosA = vdot(f.normal, ideal);
      err[i] = Math.atan2(sinA, cosA);
    }

    // fill invalid runs by interpolating the correction angle (cyclically)
    this.alpha = new Float64Array(n);
    const validIdx: number[] = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(err[i])) validIdx.push(i);
    if (validIdx.length === 0) {
      this.alpha.fill(0);
      return;
    }
    for (let v = 0; v < validIdx.length; v++) {
      const i0 = validIdx[v];
      const i1 = validIdx[(v + 1) % validIdx.length];
      const gap = (i1 - i0 + n) % n || n;
      const delta = wrapToPi(err[i1] - err[i0]);
      for (let k = 0; k <= gap; k++) {
        this.alpha[(i0 + k) % n] = err[i0] + (delta * k) / gap;
      }
    }
    // smooth the correction so applied roll changes gently
    const radius = Math.max(1, Math.round(4 / this.step));
    for (let pass = 0; pass < 3; pass++) {
      const prev = this.alpha.slice();
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const j = (i + k + n) % n;
          sum += prev[i] + wrapToPi(prev[j] - prev[i]);
        }
        this.alpha[i] = sum / (radius * 2 + 1);
      }
    }
  }

  posAt(s: number): Vec3 {
    return this.base.posAt(s);
  }

  curvatureAt(s: number): number {
    return this.base.curvatureAt(s);
  }

  private alphaAt(s: number): number {
    const n = this.alpha.length;
    let u = (((s / this.step) % n) + n) % n;
    const i0 = Math.floor(u) % n;
    const i1 = (i0 + 1) % n;
    const frac = u - Math.floor(u);
    return this.alpha[i0] + wrapToPi(this.alpha[i1] - this.alpha[i0]) * frac;
  }

  frameAt(s: number): TrackFrame {
    const f = this.base.frameAt(s);
    const a = this.alphaAt(s);
    const normal = rotateAroundAxis(f.normal, f.tangent, a);
    const binormal = cross(f.tangent, normal);
    return { pos: f.pos, tangent: f.tangent, normal, binormal };
  }
}

interface Waypoint {
  x: number;
  z: number;
  /** height above terrain (mutually exclusive with y) */
  dy?: number;
  /** absolute height */
  y?: number;
  /** named anchor for zones/events */
  tag?: string;
  /** exempt from the clearance relaxation pass (tunnel bore, loop, skim) */
  fixed?: boolean;
}

const LOOP_RADIUS = 5.5;
const MIN_CLEARANCE = 1.6;
/** arc-length margin around the tunnel markers treated as part of the bore */
const TUNNEL_APPROACH = 10;

function waypoints(): Waypoint[] {
  return [
    { x: 30, z: 18, dy: 2.5, tag: 'station' },
    { x: 38, z: 15, dy: 2.5 },
    { x: 48, z: 14, dy: 2.4, tag: 'launch-end' },
    { x: 62, z: 16, dy: 2.4 },
    { x: 72, z: 24, dy: 2.6, tag: 'lift-start' },
    { x: 78, z: 28, dy: 2.8 },
    { x: 84, z: 31, dy: 3.0 },
    { x: 88, z: 33, dy: 3.4, tag: 'summit' },
    { x: 94, z: 38, dy: 2.6 },
    { x: 97, z: 45, dy: 2.2 },
    { x: 97, z: 53, dy: 1.9, tag: 'drop-bottom' },
    { x: 93, z: 59, dy: 2.0 },
    // vertical loop is generated between these two markers
    { x: 88, z: 61, dy: 2.0, tag: 'loop-entry' },
    { x: 76, z: 63, dy: 2.0, tag: 'loop-exit' },
    { x: 68, z: 60, dy: 2.0 },
    { x: 63, z: 54, dy: 2.2 },
    { x: 68, z: 50, dy: 2.4 },
    { x: 78, z: 48, dy: 2.6 },
    { x: 84, z: 47, y: 14, fixed: true, tag: 'tunnel-entry' },
    { x: 87, z: 42, y: 13, fixed: true },
    { x: 87, z: 36, y: 13, fixed: true, tag: 'tunnel-lava' },
    { x: 87, z: 30, y: 13, fixed: true },
    { x: 87, z: 24, y: 13.5, fixed: true },
    { x: 85, z: 18, y: 14.5, fixed: true, tag: 'tunnel-exit' },
    { x: 76, z: 13, dy: 2.2 },
    { x: 62, z: 10, dy: 2.2 },
    { x: 48, z: 9, dy: 2.2 },
    { x: 38, z: 13, dy: 2.2 },
    { x: 31, z: 22, dy: 2.2 },
    { x: 27, z: 34, dy: 2.2 },
    { x: 25, z: 46, dy: 2.2 },
    { x: 24, z: 58, dy: 2.2 },
    { x: 24, z: 70, dy: 1.7 },
    { x: 26, z: 82, y: 11.6, fixed: true, tag: 'splash' },
    { x: 29, z: 90, dy: 1.8 },
    { x: 26, z: 96, dy: 2.2 },
    { x: 19, z: 92, dy: 2.2 },
    { x: 15, z: 82, dy: 2.2 },
    { x: 14, z: 70, dy: 2.2 },
    { x: 15, z: 56, dy: 2.2 },
    { x: 17, z: 43, dy: 2.2 },
    { x: 19, z: 33, dy: 2.2, tag: 'brake-start' },
    { x: 22, z: 26, dy: 2.3 },
    { x: 26, z: 21, dy: 2.4, tag: 'brake-end' },
  ];
}

/** Resolve waypoint heights against the terrain. */
function resolveHeights(wps: Waypoint[], world: World): (Waypoint & { y: number })[] {
  return wps.map((wp) => ({
    ...wp,
    y: wp.y ?? world.heightAt(Math.round(wp.x), Math.round(wp.z)) + (wp.dy ?? 2.2),
  }));
}

/**
 * Expand the loop markers into a full vertical circle. The loop lives in the
 * vertical plane of travel between entry and exit, with a small lateral drift
 * so the track doesn't intersect itself at the bottom.
 */
function expandLoop(
  points: (Waypoint & { y: number })[],
  world: World,
): (Waypoint & { y: number })[] {
  const entryIdx = points.findIndex((p) => p.tag === 'loop-entry');
  const exitIdx = points.findIndex((p) => p.tag === 'loop-exit');
  const entry = points[entryIdx];
  const exit = points[exitIdx];
  const cx = (entry.x + exit.x) / 2;
  const cz = (entry.z + exit.z) / 2;
  // base the loop on the highest terrain directly under its footprint
  let groundMax = 0;
  const x0 = Math.floor(Math.min(entry.x, exit.x) - 2);
  const x1 = Math.ceil(Math.max(entry.x, exit.x) + 2);
  const z0 = Math.floor(Math.min(entry.z, exit.z) - 4);
  const z1 = Math.ceil(Math.max(entry.z, exit.z) + 4);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      groundMax = Math.max(groundMax, world.heightAt(x, z));
    }
  }
  const y0 = Math.max(entry.y, exit.y, groundMax + 1 + MIN_CLEARANCE + 0.3);
  entry.y = y0;
  exit.y = y0;
  // travel direction in the horizontal plane
  const dirX = exit.x - entry.x;
  const dirZ = exit.z - entry.z;
  const dirLen = Math.hypot(dirX, dirZ);
  const ux = dirX / dirLen;
  const uz = dirZ / dirLen;
  // lateral (perpendicular) drift direction
  const px = -uz;
  const pz = ux;
  const drift = 2.2;

  const loop: (Waypoint & { y: number })[] = [];
  const segments = 8;
  for (let i = 1; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const along = -Math.sin(theta) * LOOP_RADIUS;
    const up = LOOP_RADIUS - Math.cos(theta) * LOOP_RADIUS;
    const lateral = (i / segments) * drift;
    loop.push({
      x: cx - along * ux + lateral * px,
      z: cz - along * uz + lateral * pz,
      y: y0 + up,
      fixed: true,
    });
  }
  // shift the exit sideways to meet the loop's drifted end
  const shiftedExit = { ...exit, x: exit.x + drift * px, z: exit.z + drift * pz, fixed: true };
  return [
    ...points.slice(0, entryIdx),
    { ...entry, fixed: true },
    ...loop,
    shiftedExit,
    ...points.slice(exitIdx + 1),
  ];
}

/** Arc-length position on the track nearest to a waypoint. */
function sNearest(track: TrackLike, x: number, y: number, z: number): number {
  let bestS = 0;
  let bestD = Infinity;
  for (let s = 0; s < track.length; s += 0.25) {
    const p = track.posAt(s);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestS = s;
    }
  }
  return bestS;
}

function isOverWater(world: World, x: number, z: number): boolean {
  return world.get(Math.floor(x), world.waterLevel, Math.floor(z)) === Block.Water;
}

export interface ClearanceViolation {
  s: number;
  clearance: number;
}

/**
 * Track-vs-terrain clearance check. The tunnel stretch is skipped with a
 * generous margin (the entrance/exit cuttings get carved out of the hillside),
 * and over water only a token clearance is required — the skim is the point.
 */
export function clearanceViolations(
  track: TrackLike,
  world: World,
  tunnelRange: { sStart: number; sEnd: number },
  minClearance: number,
): ClearanceViolation[] {
  const out: ClearanceViolation[] = [];
  for (let s = 0; s < track.length; s += 0.4) {
    if (s >= tunnelRange.sStart - TUNNEL_APPROACH && s <= tunnelRange.sEnd + TUNNEL_APPROACH) {
      continue;
    }
    const p = track.posAt(s);
    const ground = world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1;
    if (isOverWater(world, p.x, p.z)) {
      // over the lake the track may skim, but never dip into the water
      const aboveSurface = p.y - (world.waterLevel + 0.5);
      if (aboveSurface < 0) out.push({ s, clearance: aboveSurface });
      continue;
    }
    const clearance = p.y - ground;
    if (clearance < minClearance) out.push({ s, clearance });
  }
  return out;
}

export function buildRide(world: World): Ride {
  let points = expandLoop(resolveHeights(waypoints(), world), world);

  // relaxation: raise unfixed control points whose track stretch clips terrain
  let track = new Track(points.map((p) => vec3(p.x, p.y, p.z)), { closed: true });
  for (let iter = 0; iter < 60; iter++) {
    const tunnelRange = findTunnelRange(track, points);
    const violations = clearanceViolations(track, world, tunnelRange, MIN_CLEARANCE);
    if (violations.length === 0) break;
    // attribute each violation along the curve: raise the control points that
    // bracket it in arc length (nearest-by-XZ picks points on the wrong leg
    // where the circuit doubles back on itself)
    const sOfPoint = points.map((wp) => sNearest(track, wp.x, wp.y, wp.z));
    const raises = new Map<number, number>();
    for (const v of violations) {
      const need = MIN_CLEARANCE - v.clearance + 0.4;
      let before = -1;
      let after = -1;
      let beforeGap = Infinity;
      let afterGap = Infinity;
      sOfPoint.forEach((sp, i) => {
        const back = (v.s - sp + track.length) % track.length;
        const fwd = (sp - v.s + track.length) % track.length;
        if (back < beforeGap) {
          beforeGap = back;
          before = i;
        }
        if (fwd < afterGap) {
          afterGap = fwd;
          after = i;
        }
      });
      for (const idx of new Set([before, after])) {
        if (idx >= 0 && !points[idx].fixed) {
          raises.set(idx, Math.max(raises.get(idx) ?? 0, need));
        }
      }
    }
    for (const [idx, need] of raises) {
      points[idx].y = Math.min(world.sizeY - 4, points[idx].y + need);
    }
    track = new Track(points.map((p) => vec3(p.x, p.y, p.z)), { closed: true });
  }

  const tagS = (tag: string): number => {
    const wp = points.find((p) => p.tag === tag)!;
    return sNearest(track, wp.x, wp.y, wp.z);
  };

  const tunnelRange = findTunnelRange(track, points);
  const tunnelPoints: Vec3[] = [];
  for (
    let s = tunnelRange.sStart - TUNNEL_APPROACH;
    s <= tunnelRange.sEnd + TUNNEL_APPROACH;
    s += 0.75
  ) {
    const p = track.posAt(s);
    const surface = world.heightAt(Math.floor(p.x), Math.floor(p.z));
    if (p.y < surface + 1.5) tunnelPoints.push(p);
  }

  const stationS = 0;
  const launchEndS = tagS('launch-end');
  const liftStartS = tagS('lift-start');
  const summitS = tagS('summit');
  const brakeStartS = tagS('brake-start');
  const brakeEndS = tagS('brake-end');

  const zones: Zone[] = [
    { kind: 'lift', sStart: stationS, sEnd: 10, speed: 3 },
    { kind: 'launch', sStart: 10, sEnd: launchEndS, speed: 8.5 },
    { kind: 'lift', sStart: liftStartS, sEnd: summitS, speed: 4.5 },
    { kind: 'brake', sStart: brakeStartS, sEnd: brakeEndS, speed: 5.5 },
    { kind: 'lift', sStart: brakeEndS, sEnd: track.length, speed: 3 },
  ];

  // splash: the exact lowest-over-water moment near the marked waypoint
  let splashS = tagS('splash');
  let bestY = Infinity;
  for (let s = splashS - 12; s <= splashS + 12; s += 0.25) {
    const wrapped = ((s % track.length) + track.length) % track.length;
    const p = track.posAt(wrapped);
    if (isOverWater(world, p.x, p.z) && p.y < bestY) {
      bestY = p.y;
      splashS = wrapped;
    }
  }

  const loopEntry = points.find((p) => p.tag === 'loop-entry')!;
  const loopExit = points.find((p) => p.tag === 'loop-exit')!;
  const loopRange = {
    sStart: sNearest(track, loopEntry.x, loopEntry.y, loopEntry.z),
    sEnd: sNearest(track, loopExit.x, loopExit.y, loopExit.z),
  };

  return {
    track: new RideTrack(track, [loopRange]),
    zones,
    tunnelPoints,
    tunnelRange,
    loopRange,
    dropS: summitS + 2,
    splashS,
  };
}

function findTunnelRange(
  track: Track,
  points: (Waypoint & { y: number })[],
): { sStart: number; sEnd: number } {
  const entry = points.find((p) => p.tag === 'tunnel-entry')!;
  const exit = points.find((p) => p.tag === 'tunnel-exit')!;
  return {
    sStart: sNearest(track, entry.x, entry.y, entry.z),
    sEnd: sNearest(track, exit.x, exit.y, exit.z),
  };
}
