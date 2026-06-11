/** Bridges pure-core pixel buffers into Three.js textures (nearest-filtered). */
import * as THREE from 'three';
import type { PixelTexture, TextureAtlas } from '../art/textures';

export function dataTextureFrom(px: PixelTexture): THREE.DataTexture {
  const tex = new THREE.DataTexture(px.data, px.width, px.height, THREE.RGBAFormat);
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
