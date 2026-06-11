/**
 * Pooled point-sprite particle effects. All sprites are generated pixel art;
 * everything renders additively and fades by dimming per-particle color
 * (black == invisible under additive blending).
 */
import * as THREE from 'three';
import { generateTexture, type TextureName } from '../art/textures';
import { dataTextureFrom } from './gfx';

interface Pool {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  velocities: Float32Array;
  baseColors: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  gravity: number;
  cursor: number;
  capacity: number;
}

const HIDDEN_Y = -1000;

export class ParticleSystem {
  private pools = new Map<string, Pool>();

  constructor(
    private scene: THREE.Scene,
    seed: number,
  ) {
    this.makePool('spark', 'particle_spark', seed, 256, -14, 0.55);
    this.makePool('splash', 'particle_splash', seed, 512, -16, 0.7);
    this.makePool('ember', 'particle_ember', seed, 256, 2.5, 0.5);
    this.makePool('firework', 'particle_firework', seed, 1024, -5, 0.8);
  }

  private makePool(
    key: string,
    texName: TextureName,
    seed: number,
    capacity: number,
    gravity: number,
    size: number,
  ): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(capacity * 3);
    const colors = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) positions[i * 3 + 1] = HIDDEN_Y;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size,
      map: dataTextureFrom(generateTexture(texName, seed)),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.pools.set(key, {
      points,
      geometry,
      positions,
      velocities: new Float32Array(capacity * 3),
      baseColors: new Float32Array(capacity * 3),
      life: new Float32Array(capacity),
      maxLife: new Float32Array(capacity),
      gravity,
      cursor: 0,
      capacity,
    });
  }

  private emit(
    key: string,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    color: THREE.Color,
    life: number,
  ): void {
    const pool = this.pools.get(key)!;
    const i = pool.cursor;
    pool.cursor = (pool.cursor + 1) % pool.capacity;
    pool.positions.set([pos.x, pos.y, pos.z], i * 3);
    pool.velocities.set([vel.x, vel.y, vel.z], i * 3);
    pool.baseColors.set([color.r, color.g, color.b], i * 3);
    pool.life[i] = life;
    pool.maxLife[i] = life;
  }

  sparks(pos: THREE.Vector3, along: THREE.Vector3, count = 12): void {
    const color = new THREE.Color('#ffcf5e');
    for (let i = 0; i < count; i++) {
      const vel = along
        .clone()
        .multiplyScalar(2 + Math.random() * 3)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 3,
            (Math.random() - 0.5) * 4,
          ),
        );
      this.emit('spark', pos, vel, color, 0.3 + Math.random() * 0.4);
    }
  }

  splash(pos: THREE.Vector3, count = 46): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 4;
      const vel = new THREE.Vector3(
        Math.cos(angle) * r,
        5 + Math.random() * 6,
        Math.sin(angle) * r,
      );
      const c = 0.7 + Math.random() * 0.3;
      this.emit('splash', pos, vel, new THREE.Color(c * 0.55, c * 0.8, c), 0.6 + Math.random() * 0.5);
    }
  }

  ember(pos: THREE.Vector3): void {
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 1.2,
      1 + Math.random() * 2,
      (Math.random() - 0.5) * 1.2,
    );
    const c = new THREE.Color().setHSL(0.05 + Math.random() * 0.06, 1, 0.5 + Math.random() * 0.2);
    this.emit('ember', pos, vel, c, 1.2 + Math.random() * 1.2);
  }

  firework(pos: THREE.Vector3): void {
    const hue = Math.random();
    for (let i = 0; i < 70; i++) {
      // uniform direction on a sphere
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const root = Math.sqrt(1 - u * u);
      const speed = 6 + Math.random() * 7;
      const vel = new THREE.Vector3(root * Math.cos(phi), u, root * Math.sin(phi)).multiplyScalar(
        speed,
      );
      const c = new THREE.Color().setHSL(
        (hue + (Math.random() - 0.5) * 0.12 + 1) % 1,
        1,
        0.55 + Math.random() * 0.2,
      );
      this.emit('firework', pos, vel, c, 1 + Math.random() * 0.9);
    }
  }

  update(dt: number): void {
    for (const pool of this.pools.values()) {
      const { positions, velocities, baseColors, life, maxLife, capacity } = pool;
      const colorAttr = pool.geometry.getAttribute('color') as THREE.BufferAttribute;
      const colors = colorAttr.array as Float32Array;
      for (let i = 0; i < capacity; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          positions[i * 3 + 1] = HIDDEN_Y;
          colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
          continue;
        }
        velocities[i * 3 + 1] += pool.gravity * dt;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        const fade = life[i] / maxLife[i];
        colors[i * 3] = baseColors[i * 3] * fade;
        colors[i * 3 + 1] = baseColors[i * 3 + 1] * fade;
        colors[i * 3 + 2] = baseColors[i * 3 + 2] * fade;
      }
      (pool.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      colorAttr.needsUpdate = true;
    }
  }
}
