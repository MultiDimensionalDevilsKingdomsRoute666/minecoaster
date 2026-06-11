# MineCoaster — Design

**Date:** 2026-06-11
**Status:** Approved (autonomous build; user granted full creative latitude — "go crazy")

## What it is

A Minecraft-style voxel roller coaster that runs entirely in the browser. You press
**Ride** and get launched around a hand-tuned gravity coaster that threads through a
procedurally generated voxel world: up a chain lift to a snowy summit, down a monster
drop, through a vertical loop, into a glowing lava cave, and skimming across a lake.

**Every piece of art is generated** — block textures, the logo, particle sprites, the
sky — drawn as 16×16 pixel art into raw RGBA buffers at runtime. Audio is synthesized
with WebAudio. The repository contains zero binary assets.

## Goals

1. Runs in any modern browser; no server logic, static build.
2. All sprites/art/audio procedurally generated, deterministic from seeds.
3. Real coaster physics (energy-based, friction, chain lift, brake run).
4. Unit tests for all pure logic; Playwright integration tests against the
   production build; everything green in CI.
5. Published to GitHub as `minecoaster` with a complete README.

## Architecture

Two strict layers:

```
┌────────────────────────────────────────────────────────┐
│ game layer (browser-only, Three.js)                    │
│  main.ts  scene.ts  trackmesh.ts  cameras.ts  hud.ts   │
│  audio.ts  particles.ts                                │
├────────────────────────────────────────────────────────┤
│ pure core (no DOM, no Three.js — plain math & buffers) │
│  core/rng.ts      core/noise.ts    core/vec3.ts        │
│  art/textures.ts  world/worldgen.ts world/mesher.ts    │
│  coaster/track.ts coaster/physics.ts coaster/layout.ts │
└────────────────────────────────────────────────────────┘
```

The pure core is unit-tested with Vitest in Node (no jsdom needed — textures are
`Uint8ClampedArray` RGBA buffers, meshes are typed arrays). The game layer is
exercised end-to-end by Playwright against `vite preview` of the production build.

### Module contracts (pure core)

- **core/vec3.ts** — `Vec3 {x,y,z}` plain-object math helpers (add, sub, scale,
  cross, dot, normalize, length, lerp, distance). Shared by all modules; nothing
  imports Three.js outside the game layer.
- **core/rng.ts** — `hashString(s): number`, `Rng` class (mulberry32):
  `next() → [0,1)`, `int(min,max)` inclusive, `range(min,max)`, `pick(arr)`,
  `chance(p)`. Deterministic per seed.
- **core/noise.ts** — `ValueNoise2D(seed)` with `sample(x,y) → [-1,1]`, and
  `fbm2(noise,x,y,{octaves,lacunarity,gain}) → ≈[-1,1]`. Deterministic.
- **art/textures.ts** —
  `PixelTexture { name, width:16, height:16, data: Uint8ClampedArray /* RGBA */ }`;
  `TEXTURE_NAMES: readonly TextureName[]`; `generateTexture(name, seed)`;
  `buildAtlas(seed) → TextureAtlas { width, height, data, tiles: Record<TextureName,{u0,v0,u1,v1}> }`.
  Atlas packs every tile on a grid with no overlap. ~24 textures: grass top/side,
  dirt, stone, cobblestone, bedrock, sand, snow, water, lava, oak log side/top,
  leaves, planks, gold ore, diamond ore, glowstone, tnt side/top, plus particle
  sprites (spark, splash, ember, firework, star).
- **world/worldgen.ts** — `Block` enum (Air=0 … Glowstone),
  `generateWorld({seed, sizeX, sizeY, sizeZ, waterLevel}) → World` where
  `World { sizeX,sizeY,sizeZ, blocks: Uint8Array, get(x,y,z), set(x,y,z,b), heightAt(x,z) }`
  (index = `x + z*sizeX + y*sizeX*sizeZ`; out-of-bounds get → Air). Terrain from
  fbm heightmap with a mountain bias in one corner, lake basin (water below
  waterLevel), lava pocket inside the mountain, trees on grass, snow above a
  threshold, ores sprinkled in stone, bedrock floor.
  `carveTunnel(world, points: Vec3[], radius)` clears solid blocks near track
  samples (never bedrock; lines carved walls through stone with occasional
  glowstone for light).
- **world/mesher.ts** — `meshWorld(world, atlas) → { opaque, water, lava }`, each a
  `MeshData { positions, normals, uvs, colors, indices }` (Float32/Uint32 arrays).
  Face-culled (only faces exposed to air/transparent blocks), per-face texture
  selection (grass has distinct top/side/bottom), simple vertex AO baked into
  `colors`. Water/lava emitted as separate translucent/emissive meshes with
  slightly lowered top faces.
- **coaster/track.ts** — `Track(controlPoints, {closed, samplesPerSegment})`:
  centripetal Catmull-Rom through control points, dense-sampled, arc-length lookup
  table, parallel-transport frames (no flipping through the loop; for closed tracks
  the residual end-to-start twist is distributed so frames match seamlessly).
  API: `length`, `posAt(s)`, `frameAt(s) → {pos,tangent,normal,binormal}`,
  `curvatureAt(s)`, with `s` wrapping when closed.
- **coaster/physics.ts** — `CoasterSim(params)` where params:
  `{ trackLength, closed, heightAt(s), gravity, friction, drag, minSpeed, zones }`,
  `zones: {kind:'lift'|'brake'|'launch', sStart, sEnd, speed}[]`.
  `step(dt)` advances `state {s, v, lap}` with sub-stepping for stability:
  grade-based gravity accel `a = -g·dh/ds`, rolling friction, quadratic drag;
  lift zones pull v toward chain speed (never below), brake zones decelerate
  toward target, launch zones accelerate toward target, `minSpeed` prevents
  stalls. Lap increments on wrap.
- **coaster/layout.ts** — the hand-tuned ride: `WORLD_SEED`, control points in
  world coordinates, zone definitions by control-point index, and
  `buildRide() → { track, zones, world-facing metadata }` resolving zones to
  arc-length ranges. A validation helper reports track-vs-terrain clearance so
  tests can assert the ride never clips terrain after carving.

### Game layer

- **main.ts** — boot, title screen → riding state machine, **fixed-timestep**
  simulation (120 Hz accumulator) so behavior is deterministic and testable;
  exposes `window.__MC__ = { ready, version, state(), start(), warp(seconds),
  setCamera(mode), toggleMute() }` for integration tests.
- **scene.ts** — builds Three.js scene from pure data: terrain/water/lava meshes
  from `MeshData`, atlas as a `DataTexture` (NearestFilter for crisp pixels), sky
  dome with day/night cycle (sun/moon billboards from generated sprites, stars),
  fog, torch-flicker point lights in the tunnel, animated water UV scroll.
- **trackmesh.ts** — extrudes rails, cross-ties, and support pillars along track
  frames into geometry; wooden-coaster look using plank/log atlas tiles.
- **cameras.ts** — onboard (first person, FOV kick + shake scaled by speed/G),
  chase, and orbit cinematic cameras; `C` cycles.
- **hud.ts** — DOM overlay: generated pixel logo, speed (m/s), height, G-force,
  lap counter, camera/mute hints. Title screen with animated logo + Ride button.
- **particles.ts** — spark burst on brake run, splash sheet at the lake pass,
  embers in the lava cave, fireworks on each lap completion.
- **audio.ts** — WebAudio synthesis: chain-lift clank loop, speed-scaled wind
  noise, whoosh on the drop, splash, firework pops, ambient pad. Muted until
  user gesture; `M` toggles.

## Testing

**Unit (Vitest, Node, no DOM):** RNG/noise determinism and ranges; texture
dimensions/opacity/determinism/distinctness and atlas packing; worldgen
invariants (bedrock floor, water only at/below water level, trees rooted on
grass, determinism) and carve behavior; mesher correctness on tiny hand-built
worlds (face counts, no faces between two solids, AO color range, water mesh
separation); track math (arc-length monotonicity, frame orthonormality through
the loop, closed-track frame continuity); physics (energy decreases with
friction on flat track, lift raises v to chain speed, brake slows, lap wrap,
min-speed clamp); layout validation (track in bounds, clearance after carve,
zones resolve sane).

**Integration (Playwright vs production build, headless Chromium + SwiftShader):**
page loads without console errors; title screen visible; WebGL canvas paints
non-uniform pixels after starting; Ride starts the sim (s and HUD speed change);
`warp(120)` completes ≥1 lap and fires fireworks; camera cycling works; mute
toggles; screenshot artifact captured.

**CI (GitHub Actions):** unit tests → typecheck+build → Playwright integration,
on push/PR. A separate workflow deploys the build to GitHub Pages.

## Decisions & trade-offs

- **Three.js over raw WebGL**: one runtime dependency buys robust rendering;
  the pure core stays dependency-free so tests don't need a GPU.
- **Buffers over canvas for art**: texture generators emit RGBA arrays, so art is
  unit-testable in Node; the game layer wraps them in `DataTexture`.
- **One epic track over an editor**: a hand-tuned ride with themed zones is more
  fun per line of code than a generic editor (YAGNI).
- **Fixed-timestep sim**: deterministic physics enables the `warp()` test hook
  and reproducible integration tests.
- **Repo is public**: it's a game meant to be shared, and GitHub Pages hosting
  requires it on the free plan.
