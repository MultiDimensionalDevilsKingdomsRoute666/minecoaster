/**
 * Three camera modes cycled with C:
 *  - onboard: front seat, FOV widens and the view shakes with speed
 *  - chase:   damped follow-cam behind the cart
 *  - orbit:   slow cinematic circle around the cart
 */
import * as THREE from 'three';
import type { TrackFrame } from '../coaster/track';

export type CameraMode = 'onboard' | 'chase' | 'orbit';

const MODES: CameraMode[] = ['onboard', 'chase', 'orbit'];

export interface CameraInputs {
  frame: TrackFrame;
  speed: number;
  curvature: number;
  time: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'onboard';
  private chasePos = new THREE.Vector3();
  private orbitTarget = new THREE.Vector3();
  private fov = 72;
  private initialized = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.1, 400);
  }

  cycle(): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.initialized = false;
    return this.mode;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, { frame, speed, curvature, time }: CameraInputs): void {
    const pos = new THREE.Vector3(frame.pos.x, frame.pos.y, frame.pos.z);
    const tangent = new THREE.Vector3(frame.tangent.x, frame.tangent.y, frame.tangent.z);
    const normal = new THREE.Vector3(frame.normal.x, frame.normal.y, frame.normal.z);

    if (this.mode === 'onboard') {
      // front-row seat: far enough forward that the cart body reads as a small
      // hood at the bottom of the frame instead of a wall
      const seat = pos.clone().addScaledVector(normal, 1.4).addScaledVector(tangent, 0.95);
      // speed shake: layered sines look random but stay deterministic
      const shakeAmp = Math.min(0.1, speed * 0.0022 + curvature * speed * speed * 0.0012);
      seat.addScaledVector(normal, Math.sin(time * 37.1) * shakeAmp);
      seat.addScaledVector(
        new THREE.Vector3().crossVectors(tangent, normal),
        Math.sin(time * 29.7 + 1.3) * shakeAmp,
      );
      this.camera.position.copy(seat);
      this.camera.up.copy(normal);
      this.camera.lookAt(seat.clone().addScaledVector(tangent, 12).addScaledVector(normal, 0.35));
      const targetFov = 72 + Math.min(22, speed * 0.55);
      this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    } else if (this.mode === 'chase') {
      const flatBack = new THREE.Vector3(tangent.x, 0, tangent.z);
      if (flatBack.lengthSq() < 1e-6) flatBack.set(1, 0, 0);
      flatBack.normalize();
      const desired = pos.clone().addScaledVector(flatBack, -9).add(new THREE.Vector3(0, 4, 0));
      if (!this.initialized) {
        this.chasePos.copy(desired);
        this.initialized = true;
      }
      this.chasePos.lerp(desired, 1 - Math.exp(-dt * 3.2));
      this.camera.position.copy(this.chasePos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(pos.clone().addScaledVector(normal, 1));
      this.resetFov(dt);
    } else {
      if (!this.initialized) {
        this.orbitTarget.copy(pos);
        this.initialized = true;
      }
      this.orbitTarget.lerp(pos, 1 - Math.exp(-dt * 1.5));
      const angle = time * 0.25;
      this.camera.position.set(
        this.orbitTarget.x + Math.cos(angle) * 26,
        this.orbitTarget.y + 11,
        this.orbitTarget.z + Math.sin(angle) * 26,
      );
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.orbitTarget);
      this.resetFov(dt);
    }
  }

  private resetFov(dt: number): void {
    this.fov += (72 - this.fov) * Math.min(1, dt * 4);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }
}
