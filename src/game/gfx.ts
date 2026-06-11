/** Bridges pure-core pixel buffers into Three.js textures (nearest-filtered). */
import * as THREE from 'three';
import type { PixelTexture, TextureAtlas } from '../art/textures';

export function dataTextureFrom(px: PixelTexture): THREE.DataTexture {
  // PixelTexture rows are top-first (textures.ts contract), but BoxGeometry /
  // point-sprite UVs put v=1 at the visual top while DataTexture's flipY=false
  // samples v=1 from the LAST row — so flip rows at upload or the TNT label
  // renders upside down. (The atlas is NOT flipped: the mesher assigns tile
  // v-coordinates in the same top-first convention as the atlas buffer.)
  const rowBytes = px.width * 4;
  const flipped = new Uint8ClampedArray(px.data.length);
  for (let y = 0; y < px.height; y++) {
    flipped.set(
      px.data.subarray(y * rowBytes, (y + 1) * rowBytes),
      (px.height - 1 - y) * rowBytes,
    );
  }
  const tex = new THREE.DataTexture(flipped, px.width, px.height, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function atlasTextureFrom(atlas: TextureAtlas): THREE.DataTexture {
  const tex = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
