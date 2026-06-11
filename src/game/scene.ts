/**
 * Assembles the visible world: voxel terrain meshes, a day/night sky with a
 * proper square Minecraft sun, stars, fog, and flickering glowstone/lava
 * lights inside the tunnel.
 */
import * as THREE from 'three';
import { meshWorld, type MeshData } from '../world/mesher';
import { Block, type World } from '../world/worldgen';
import { buildAtlas, generateTexture } from '../art/textures';
import { atlasTextureFrom, dataTextureFrom } from './gfx';

export const DAY_LENGTH_SECONDS = 150;
const MAX_GLOW_LIGHTS = 6;

function geometryFrom(data: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geo;
}

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly lavaCenter: THREE.Vector3 | null = null;
  private sun: THREE.Sprite;
  private moon: THREE.Sprite;
  private stars: THREE.Points;
  private sunLight: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private waterMat: THREE.MeshLambertMaterial;
  private glowLights: THREE.PointLight[] = [];
  private lavaLight: THREE.PointLight | null = null;
  private center: THREE.Vector3;
  private skyDay = new THREE.Color('#7fb8ff');
  private skyNight = new THREE.Color('#070b18');
  private skySunset = new THREE.Color('#ff9a5c');

  constructor(world: World, seed: number) {
    this.center = new THREE.Vector3(world.sizeX / 2, 10, world.sizeZ / 2);
    const atlas = buildAtlas(seed);
    const atlasTex = atlasTextureFrom(atlas);
    const meshes = meshWorld(world, atlas);

    const opaque = new THREE.Mesh(
      geometryFrom(meshes.opaque),
      new THREE.MeshLambertMaterial({ map: atlasTex, vertexColors: true }),
    );
    this.scene.add(opaque);

    this.waterMat = new THREE.MeshLambertMaterial({
      map: atlasTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(geometryFrom(meshes.water), this.waterMat));

    // lava is unlit so it glows in the dark tunnel
    this.scene.add(
      new THREE.Mesh(
        geometryFrom(meshes.lava),
        new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true }),
      ),
    );

    this.scene.fog = new THREE.Fog('#7fb8ff', 60, 230);

    this.ambient = new THREE.AmbientLight('#ffffff', 0.55);
    this.scene.add(this.ambient);
    this.sunLight = new THREE.DirectionalLight('#fff4d6', 1.6);
    this.scene.add(this.sunLight, this.sunLight.target);

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#fff3a8', fog: false }));
    this.sun.scale.setScalar(17);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#d9e4ff', fog: false }));
    this.moon.scale.setScalar(11);
    this.scene.add(this.sun, this.moon);

    this.stars = this.buildStars(seed);
    this.scene.add(this.stars);

    this.placeBlockLights(world);
  }

  private buildStars(seed: number): THREE.Points {
    const count = 420;
    const positions = new Float32Array(count * 3);
    // deterministic-enough star field from a tiny LCG, decorative only
    let s = seed >>> 0 || 1;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      positions[i * 3] = this.center.x + r * Math.cos(phi) * 240;
      positions[i * 3 + 1] = this.center.y + Math.abs(u) * 240 + 10;
      positions[i * 3 + 2] = this.center.z + r * Math.sin(phi) * 240;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.6,
      map: dataTextureFrom(generateTexture('particle_star', 1)),
      transparent: true,
      depthWrite: false,
      opacity: 0,
      sizeAttenuation: false,
    });
    mat.fog = false;
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }

  private placeBlockLights(world: World): void {
    const glow: THREE.Vector3[] = [];
    const lava: THREE.Vector3[] = [];
    for (let y = 0; y < world.sizeY; y++) {
      for (let z = 0; z < world.sizeZ; z++) {
        for (let x = 0; x < world.sizeX; x++) {
          const b = world.get(x, y, z);
          if (b === Block.Glowstone) glow.push(new THREE.Vector3(x + 0.5, y + 1.5, z + 0.5));
          else if (b === Block.Lava) lava.push(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
        }
      }
    }
    const stride = Math.max(1, Math.floor(glow.length / MAX_GLOW_LIGHTS));
    for (let i = 0; i < glow.length && this.glowLights.length < MAX_GLOW_LIGHTS; i += stride) {
      const light = new THREE.PointLight('#ffb24d', 30, 16, 2);
      light.position.copy(glow[i]);
      this.glowLights.push(light);
      this.scene.add(light);
    }
    if (lava.length > 0) {
      const c = lava
        .reduce((acc, v) => acc.add(v), new THREE.Vector3())
        .divideScalar(lava.length);
      this.lavaLight = new THREE.PointLight('#ff5a1f', 80, 24, 2);
      this.lavaLight.position.copy(c).add(new THREE.Vector3(0, 2, 0));
      this.scene.add(this.lavaLight);
      (this as { lavaCenter: THREE.Vector3 | null }).lavaCenter = c;
    }
  }

  /** Advance sky, lights, and water shimmer. `time` is seconds since boot. */
  update(time: number, cartPos: THREE.Vector3): void {
    const dayT = (0.22 + time / DAY_LENGTH_SECONDS) % 1;
    const angle = dayT * Math.PI * 2;
    const sunY = Math.sin(angle);
    const dayF = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(sunY * 2.5 + 0.25, 0, 1), 0, 1);
    const sunsetF = THREE.MathUtils.clamp(1 - Math.abs(sunY) * 3.5, 0, 1);

    const sky = this.skyNight.clone().lerp(this.skyDay, dayF).lerp(this.skySunset, sunsetF * 0.45);
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(sky);

    const sunDir = new THREE.Vector3(Math.cos(angle), sunY, 0.3).normalize();
    this.sun.position.copy(this.center).addScaledVector(sunDir, 250);
    this.moon.position.copy(this.center).addScaledVector(sunDir, -250);

    this.sunLight.intensity = 0.25 + dayF * 1.5;
    this.sunLight.color.set(sunsetF > 0.3 ? '#ffc89a' : '#fff4d6');
    this.sunLight.position.copy(cartPos).addScaledVector(sunY > 0 ? sunDir : sunDir.clone().negate(), 60);
    this.sunLight.target.position.copy(cartPos);
    this.ambient.intensity = 0.18 + dayF * 0.4;

    (this.stars.material as THREE.PointsMaterial).opacity = (1 - dayF) * 0.9;

    this.waterMat.opacity = 0.74 + Math.sin(time * 1.6) * 0.05;

    this.glowLights.forEach((light, i) => {
      light.intensity = 30 * (0.8 + 0.25 * Math.sin(time * 11 + i * 2.1));
    });
    if (this.lavaLight) {
      this.lavaLight.intensity = 80 * (0.8 + 0.3 * Math.sin(time * 7.3));
    }
  }
}
