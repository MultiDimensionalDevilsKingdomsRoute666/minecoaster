export type ZoneKind = 'lift' | 'brake' | 'launch';

export interface Zone {
  kind: ZoneKind;
  sStart: number;
  sEnd: number;
  speed: number;
}

export interface CoasterParams {
  trackLength: number;
  closed: boolean;
  heightAt: (s: number) => number;
  gravity?: number;
  friction?: number;
  drag?: number;
  minSpeed?: number;
  zones: Zone[];
}

export interface CoasterState {
  s: number;
  v: number;
  lap: number;
}

const MAX_SUBSTEP = 1 / 240;
const GRADE_DS = 0.25;
const LIFT_ACCEL = 4;
const LAUNCH_ACCEL = 12;
const BRAKE_DECEL = 8;

export class CoasterSim {
  readonly state: CoasterState = { s: 0, v: 0, lap: 0 };

  private readonly trackLength: number;
  private readonly closed: boolean;
  private readonly heightAt: (s: number) => number;
  private readonly gravity: number;
  private readonly friction: number;
  private readonly drag: number;
  private readonly minSpeed: number;
  private readonly zones: readonly Zone[];

  constructor(params: CoasterParams) {
    this.trackLength = params.trackLength;
    this.closed = params.closed;
    this.heightAt = params.heightAt;
    this.gravity = params.gravity ?? 9.81;
    this.friction = params.friction ?? 0.015;
    this.drag = params.drag ?? 0.0003;
    this.minSpeed = params.minSpeed ?? 0.5;
    this.zones = [...params.zones];
  }

  reset(s = 0, v = 0): void {
    this.state.s = s;
    this.state.v = v;
    this.state.lap = 0;
  }

  step(dt: number): void {
    if (!(dt > 0)) return;
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);
  }

  zoneAt(s: number): Zone | null {
    const q = this.closed ? this.wrap(s) : s;
    for (const z of this.zones) {
      if (q >= z.sStart && q < z.sEnd) return z;
    }
    return null;
  }

  private wrap(s: number): number {
    const w = s % this.trackLength;
    return w < 0 ? w + this.trackLength : w;
  }

  private gradeAt(s: number): number {
    if (this.closed) {
      return (
        (this.heightAt(this.wrap(s + GRADE_DS)) - this.heightAt(this.wrap(s - GRADE_DS))) /
        (2 * GRADE_DS)
      );
    }
    const a = Math.max(0, s - GRADE_DS);
    const b = Math.min(this.trackLength, s + GRADE_DS);
    if (b - a < 1e-9) return 0;
    return (this.heightAt(b) - this.heightAt(a)) / (b - a);
  }

  private substep(h: number): void {
    const st = this.state;
    const g = this.gravity;
    const zone = this.zoneAt(st.s);
    const v0 = st.v;

    const accel =
      -g * this.gradeAt(st.s) - this.friction * g * Math.sign(v0) - this.drag * v0 * Math.abs(v0);
    const vFree = v0 + accel * h;

    let v: number;
    if (zone?.kind === 'lift') {
      // The chain ratchets: v can exceed the floor (e.g. downhill) but never
      // drop below the chain pull, and never go negative.
      const floor = Math.min(zone.speed, v0 + LIFT_ACCEL * h);
      v = Math.max(vFree, floor, 0);
    } else if (zone?.kind === 'launch') {
      v = v0 < zone.speed ? Math.min(zone.speed, v0 + LAUNCH_ACCEL * h) : vFree;
    } else if (zone?.kind === 'brake') {
      v = v0 > zone.speed ? Math.max(zone.speed, v0 - BRAKE_DECEL * h) : vFree;
    } else {
      v = vFree;
    }
    if (zone?.kind !== 'brake') v = Math.max(v, this.minSpeed);

    st.s += v * h;
    if (this.closed) {
      if (st.s >= this.trackLength) {
        st.s -= this.trackLength;
        st.lap++;
      } else if (st.s < 0) {
        st.s += this.trackLength;
        st.lap--;
      }
    } else if (st.s >= this.trackLength) {
      st.s = this.trackLength;
      v = 0;
    } else if (st.s <= 0 && v < 0) {
      st.s = 0;
      v = 0;
    }
    st.v = v;
  }
}
