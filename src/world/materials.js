// Shared materials and prop geometry. Weather/time effects are a few shared uniforms.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const env = {
  uTime: { value: 0 },
  uWind: { value: 0 },  // 0..1.5
  uSnow: { value: 0 },  // 0..1
  uWet: { value: 0 },   // 0..1
  uNight: { value: 0 }, // 0..1
};

function hook(material, key, { vertex, fragment, after = '#include <map_fragment>' }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    const decl = 'uniform float uTime; uniform float uWind; uniform float uSnow; uniform float uWet;\n';
    shader.vertexShader = decl + shader.vertexShader;
    shader.fragmentShader = decl + shader.fragmentShader;
    if (vertex) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertex);
    if (fragment) shader.fragmentShader = shader.fragmentShader.replace(after, after + '\n' + fragment);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export function terrainMat(map) {
  return hook(new THREE.MeshLambertMaterial({ map }), 'er-terrain', {
    fragment: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * 0.8); diffuseColor.rgb *= 1.0 - uWet * 0.18;',
  });
}

// Roads: vertex colours, drawn on top of the ground; wet roads go darker and a little glossy-looking.
export const roadMat = hook(new THREE.MeshLambertMaterial({
  vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
}), 'er-road', {
  fragment: 'diffuseColor.rgb *= 1.0 - uWet * 0.3; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95), uSnow * 0.35);',
  after: '#include <color_fragment>',
});
// Roads always show over the ground they run across: the terrain mesh is coarser than the roads, so
// in places it bulges a little above them. Each road vertex is drawn a little towards the camera
// (more with distance, where the terrain is coarsest), so roads win against terrain that's just
// above them, while real hills and buildings in front still hide them.
roadMat.onBeforeCompile = ((prev) => (sh, r) => {
  prev?.(sh, r);
  sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    { float d = length(mvPosition.xyz);
      mvPosition.xyz -= mvPosition.xyz / max(d, 0.001) * clamp(0.08 + d * 0.012, 0.0, 1.6);
      gl_Position = projectionMatrix * mvPosition; }`);
})(roadMat.onBeforeCompile);
roadMat.customProgramCacheKey = () => 'er-road-front';

const SWAY = `
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
  float bend = (position.y + 1.0) * uWind;
  transformed.x += sin(uTime * 1.7 + ph) * 0.07 * bend;
  transformed.z += cos(uTime * 1.3 + ph) * 0.05 * bend;
#endif`;
export const treeMat = hook(new THREE.MeshLambertMaterial({ flatShading: true }), 'er-tree', {
  vertex: SWAY,
  fragment: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), uSnow * 0.45);',
  after: '#include <color_fragment>',
});
export const trunkMat = new THREE.MeshLambertMaterial({ color: '#7a5c42' });
// Buildings: windows drawn by the shader (floors every 3.2 m), some lit at night. No extra geometry.
export const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
buildingMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, env);
  shader.vertexShader = 'attribute vec2 aB; varying vec3 vWP; varying vec3 vON; varying vec2 vB;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vON = normal; vB = aB;');
  shader.fragmentShader = 'uniform float uNight; uniform float uSnow; varying vec3 vWP; varying vec3 vON; varying vec2 vB;\nfloat hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' + shader.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      // window styles: 1 house, 2 apartments/shops, 3 glass tower, 4 warehouse; tint = shutters etc.
      float st = mod(vB.x, 10.0), tint = floor(vB.x / 10.0 + 0.01);
      float wallF = (1.0 - step(0.5, abs(vON.y))) * step(0.5, st);
      float rel = vWP.y - vB.y;
      float hz = dot(vWP.xz, normalize(vec2(-vON.z, vON.x) + 1e-5));
      float sp = st < 1.5 ? 3.6 : st < 2.5 ? 2.8 : st < 3.5 ? 1.7 : 6.0;
      float fh = st < 1.5 ? 2.9 : st < 3.5 ? 3.3 : 5.0;
      vec2 cell = vec2(floor(hz / sp), floor(rel / fh));
      vec2 f = vec2(fract(hz / sp), fract(rel / fh));
      float x0 = 0.24, x1 = 0.76, y0 = 0.3, y1 = 0.8;
      if (st > 2.5 && st < 3.5) { x0 = 0.05; x1 = 0.95; y0 = 0.08; y1 = 0.94; }
      if (st > 1.5 && st < 2.5 && rel < 4.2) { x0 = 0.06; x1 = 0.94; y0 = 0.12; y1 = 0.85; } // shopfronts
      if (st > 3.5) { x0 = 0.04; x1 = 0.96; y0 = 0.62; y1 = 0.8; }
      float win = wallF * step(x0, f.x) * step(f.x, x1) * step(y0, f.y) * step(f.y, y1) * step(0.4, rel);
      vec3 glass = st > 2.5 && st < 3.5 ? vec3(0.38, 0.5, 0.62) : rel < 4.2 && st > 1.5 && st < 2.5 ? vec3(0.32, 0.36, 0.4) : vec3(0.42, 0.47, 0.55);
      if (tint > 2.5) glass = vec3(0.5, 0.55, 0.62);
      diffuseColor.rgb = mix(diffuseColor.rgb, st > 2.5 && st < 3.5 ? glass : diffuseColor.rgb * glass, win * 0.88);
      // shutters either side of the window (Mediterranean / Middle East)
      float shut = wallF * (1.0 - win) * step(0.5, tint) * step(tint, 2.5) * step(0.4, rel - 4.2)
        * (step(0.1, f.x) * step(f.x, 0.24) + step(0.76, f.x) * step(f.x, 0.9)) * step(y0, f.y) * step(f.y, y1);
      vec3 shutC = tint < 1.5 ? vec3(0.3, 0.45, 0.32) : vec3(0.48, 0.34, 0.22);
      diffuseColor.rgb = mix(diffuseColor.rgb, shutC, shut * 0.9);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * step(0.5, abs(vON.y)) * 0.8);
      float lit = win * step(rel < 4.2 && st > 1.5 && st < 2.5 ? 0.3 : 0.62, hsh(cell + floor(vWP.xz / 40.0))) * uNight;`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.82, 0.5) * lit * 0.85;');
};
buildingMat.customProgramCacheKey = () => 'er-building';

export const treeGeo = new THREE.IcosahedronGeometry(1, 0);
export const coneGeo = new THREE.ConeGeometry(1, 1, 7);
export const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 1, 5).translate(0, 0.5, 0);

// Street light: pole + arm reaching over the road (+x), head lit at night.
export const lampGeo = mergeGeometries([
  new THREE.CylinderGeometry(0.09, 0.13, 7.5, 6).translate(0, 3.75, 0),
  new THREE.BoxGeometry(1.8, 0.1, 0.1).translate(0.85, 7.4, 0),
]);
export const lampHeadGeo = new THREE.BoxGeometry(0.7, 0.18, 0.35).translate(1.65, 7.3, 0);
export const lampMat = new THREE.MeshLambertMaterial({ color: '#5d6166' });
export const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#c9c6bb' });
// Reflector post: white post with a band.
export const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0);
export const postMat = new THREE.MeshLambertMaterial({ color: '#f1f1ec', emissive: '#000000' });

/** 0 = day, 1 = night: street lights glow and reflectors catch the headlights. */
export function setNight(n) {
  env.uNight.value = n;
  lampHeadMat.color.setRGB(0.79 + n * 0.21, 0.78 + n * 0.17, 0.73 - n * 0.08);
  postMat.emissive.setRGB(n * 0.35, n * 0.33, n * 0.25);
}
