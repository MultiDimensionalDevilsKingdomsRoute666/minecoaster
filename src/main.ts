/**
 * Boot + game loop. Simulation runs on a fixed 120 Hz timestep accumulator so
 * physics and ride events are deterministic — that's what makes the
 * integration-test `warp()` hook possible.
 */
import * as THREE from 'three';
import { generateWorld, carveTunnel } from './world/worldgen';
import { WORLD_SEED, buildRide, type Ride } from './coaster/layout';
import { CoasterSim } from './coaster/physics';
import { GameScene } from './game/scene';
import { buildTrackGroup, buildCart } from './game/trackmesh';
import { CameraRig, type CameraMode } from './game/cameras';
import { Hud } from './game/hud';
import { GameAudio } from './game/audio';
import { ParticleSystem } from './game/particles';

const FIXED_DT = 1 / 120;
const VERSION = '1.0.0';

type Mode = 'title' | 'riding';

interface McState {
  mode: Mode;
  s: number;
  v: number;
  lap: number;
  time: number;
  camera: CameraMode;
  muted: boolean;
  fireworks: number;
  /** arc-length landmarks of the ride, for tests and debugging */
  landmarks: {
    trackLength: number;
    dropS: number;
    splashS: number;
    tunnel: { sStart: number; sEnd: number };
    loop: { sStart: number; sEnd: number };
  };
}

export interface McApi {
  ready: boolean;
  version: string;
  start: () => void;
  state: () => McState;
  warp: (seconds: number) => void;
  setCamera: (mode: CameraMode) => void;
  toggleMute: () => boolean;
}

declare global {
  interface Window {
    __MC__?: McApi;
  }
}

class Game {
  private mode: Mode = 'title';
  private gameTime = 0;
  private accumulator = 0;
  private lastFrame = performance.now();
  private prevS = 0;
  private fireworksSeen = 0;
  private scheduled: { at: number; fn: () => void }[] = [];

  private world = generateWorld({ seed: WORLD_SEED });
  private ride: Ride;
  private sim: CoasterSim;
  private gameScene: GameScene;
  private cart: THREE.Group;
  private rig: CameraRig;
  private hud: Hud;
  private audio = new GameAudio();
  private particles: ParticleSystem;
  private renderer: THREE.WebGLRenderer;

  constructor(root: HTMLElement) {
    this.ride = buildRide(this.world);
    carveTunnel(this.world, this.ride.tunnelPoints, 2.8);

    this.sim = new CoasterSim({
      trackLength: this.ride.track.length,
      closed: true,
      heightAt: (s) => this.ride.track.posAt(s).y,
      zones: this.ride.zones,
    });

    this.gameScene = new GameScene(this.world, WORLD_SEED);
    this.gameScene.scene.add(buildTrackGroup(this.ride.track, this.world, WORLD_SEED));
    this.cart = buildCart(WORLD_SEED);
    this.gameScene.scene.add(this.cart);
    this.particles = new ParticleSystem(this.gameScene.scene, WORLD_SEED);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    root.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.rig.setAspect(window.innerWidth / window.innerHeight);
    });

    this.hud = new Hud(root, {
      onStart: () => this.start(),
      onCycleCamera: () => this.cycleCamera(),
      onToggleMute: () => this.audio.toggleMuted(),
    });

    this.placeCart();
    requestAnimationFrame(this.frame);
  }

  start(): void {
    if (this.mode === 'riding') return;
    this.mode = 'riding';
    this.audio.resume();
    this.hud.hideTitle();
    this.sim.reset(0, 0);
    this.prevS = 0;
  }

  cycleCamera(): CameraMode {
    return this.rig.cycle();
  }

  toggleMute(): boolean {
    return this.audio.toggleMuted();
  }

  setCamera(mode: CameraMode): void {
    while (this.rig.mode !== mode) this.rig.cycle();
  }

  private placeCart(): void {
    const f = this.ride.track.frameAt(this.sim.state.s);
    const t = new THREE.Vector3(f.tangent.x, f.tangent.y, f.tangent.z);
    const n = new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z);
    const b = new THREE.Vector3(f.binormal.x, f.binormal.y, f.binormal.z);
    this.cart.position.set(f.pos.x, f.pos.y, f.pos.z).addScaledVector(n, 0.15);
    this.cart.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(b, n, t));
  }

  /** Did the ride pass arc-length position `mark` during the last step? */
  private crossed(mark: number, s: number): boolean {
    if (this.prevS <= s) return this.prevS < mark && mark <= s;
    return mark > this.prevS || mark <= s; // wrapped past the seam
  }

  private fixedUpdate(dt: number): void {
    this.gameTime += dt;
    this.scheduled = this.scheduled.filter((task) => {
      if (this.gameTime >= task.at) {
        task.fn();
        return false;
      }
      return true;
    });

    if (this.mode !== 'riding') return;

    const lapBefore = this.sim.state.lap;
    this.sim.step(dt);
    const { s, v, lap } = this.sim.state;
    const cartPos = this.cart.position;

    if (this.crossed(this.ride.dropS, s)) {
      this.audio.whoosh();
      this.hud.toast('THE DROP!');
    }
    if (this.crossed(this.ride.splashS, s)) {
      this.audio.splash();
      this.particles.splash(cartPos.clone().setY(this.world.waterLevel + 1));
      this.hud.toast('SPLASH!');
    }

    const zone = this.sim.zoneAt(s);
    if (zone?.kind === 'brake' && this.crossed(zone.sStart, s)) {
      this.audio.screech();
    }
    if (zone?.kind === 'brake' && v > 7 && Math.floor(this.gameTime * 20) % 2 === 0) {
      const f = this.ride.track.frameAt(s);
      this.particles.sparks(
        cartPos.clone().addScaledVector(new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z), -0.1),
        new THREE.Vector3(-f.tangent.x, -f.tangent.y, -f.tangent.z),
        4,
      );
    }

    const inTunnel = s >= this.ride.tunnelRange.sStart && s <= this.ride.tunnelRange.sEnd;
    if (inTunnel && this.gameScene.lavaCenter && Math.floor(this.gameTime * 30) % 3 === 0) {
      const c = this.gameScene.lavaCenter;
      this.particles.ember(
        new THREE.Vector3(
          c.x + (Math.random() - 0.5) * 5,
          c.y + 1,
          c.z + (Math.random() - 0.5) * 5,
        ),
      );
    }

    if (lap > lapBefore) {
      this.fireworksSeen++;
      this.audio.lapChime();
      this.hud.toast(`LAP ${lap + 1}!`);
      for (let i = 0; i < 4; i++) {
        const burstPos = cartPos
          .clone()
          .add(
            new THREE.Vector3((Math.random() - 0.5) * 24, 14 + Math.random() * 8, (Math.random() - 0.5) * 24),
          );
        this.scheduled.push({
          at: this.gameTime + i * 0.35,
          fn: () => {
            this.particles.firework(burstPos);
            this.audio.fireworkPop();
          },
        });
      }
    }

    this.audio.update(dt, v, zone?.kind === 'lift');
    this.placeCart();
    this.prevS = s;
  }

  /** Deterministically advance the simulation (integration-test hook). */
  warp(seconds: number): void {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) this.fixedUpdate(FIXED_DT);
  }

  state(): McState {
    return {
      mode: this.mode,
      s: this.sim.state.s,
      v: this.sim.state.v,
      lap: this.sim.state.lap,
      time: this.gameTime,
      camera: this.rig.mode,
      muted: this.audio.isMuted,
      fireworks: this.fireworksSeen,
      landmarks: {
        trackLength: this.ride.track.length,
        dropS: this.ride.dropS,
        splashS: this.ride.splashS,
        tunnel: this.ride.tunnelRange,
        loop: this.ride.loopRange,
      },
    };
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const elapsed = Math.min((now - this.lastFrame) / 1000, 0.25);
    this.lastFrame = now;
    this.accumulator += elapsed;
    while (this.accumulator >= FIXED_DT) {
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    const { s, v } = this.sim.state;
    if (this.mode === 'riding') {
      this.rig.update(elapsed, {
        frame: this.ride.track.frameAt(s),
        speed: v,
        curvature: this.ride.track.curvatureAt(s),
        time: this.gameTime,
      });
    } else {
      // title screen: slow cinematic orbit of the whole park
      const angle = this.gameTime * 0.06 + 1.2;
      const c = new THREE.Vector3(this.world.sizeX / 2, 14, this.world.sizeZ / 2);
      this.rig.camera.position.set(
        c.x + Math.cos(angle) * 62,
        30,
        c.z + Math.sin(angle) * 62,
      );
      this.rig.camera.up.set(0, 1, 0);
      this.rig.camera.lookAt(c);
      this.gameTime += elapsed * 0.2;
    }

    this.particles.update(elapsed);
    this.gameScene.update(this.gameTime, this.cart.position);

    const ground = this.world.heightAt(Math.floor(this.cart.position.x), Math.floor(this.cart.position.z));
    this.hud.setStats({
      speed: v,
      height: Math.max(0, this.cart.position.y - ground - 1),
      g: 1 + (v * v * this.ride.track.curvatureAt(s)) / 9.81,
      lap: this.sim.state.lap + (this.mode === 'riding' ? 1 : 0),
      camera: this.rig.mode,
      muted: this.audio.isMuted,
    });

    this.renderer.render(this.gameScene.scene, this.rig.camera);
  };
}

const root = document.getElementById('app')!;
const game = new Game(root);

window.__MC__ = {
  ready: true,
  version: VERSION,
  start: () => game.start(),
  state: () => game.state(),
  warp: (seconds: number) => game.warp(seconds),
  setCamera: (mode: CameraMode) => game.setCamera(mode),
  toggleMute: () => game.toggleMute(),
};
