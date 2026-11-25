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
export const roadFocus = { value: new THREE.Vector3(0, 0, 0) }; // the player's vehicle (set every frame)
roadMat.onBeforeCompile = ((prev) => (sh, r) => {
  prev?.(sh, r);
  sh.uniforms.uFocus = roadFocus;
  sh.vertexShader = `uniform vec3 uFocus;
` + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    { vec4 wp = modelMatrix * vec4(transformed, 1.0);
      // none of this near your vehicle (or it would draw the road over the car's wheels and over
      // nearby traffic): there the terrain is already pressed down under the road
      float near = smoothstep(12.0, 35.0, distance(wp.xz, uFocus.xz));
      float d = length(mvPosition.xyz);
      mvPosition.xyz -= mvPosition.xyz / max(d, 0.001) * clamp(d * 0.012 - 0.1, 0.0, 1.4) * near;
      gl_Position = projectionMatrix * mvPosition; }`);
})(roadMat.onBeforeCompile);
roadMat.customProgramCacheKey = () => 'er-road-front-2';

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
// Buildings: windows drawn by the shader (floor height by use), some lit at night. No extra geometry.
export const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
buildingMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, env);
  shader.vertexShader = 'attribute vec2 aB; varying vec3 vWP; varying vec3 vON; varying vec2 vB;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vON = normal; vB = aB;');
  shader.fragmentShader = 'uniform float uNight; uniform float uSnow; varying vec3 vWP; varying vec3 vON; varying vec2 vB;\nfloat hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' + shader.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      // window styles: 1 house, 2 shopfront with floors above, 3 glass tower, 4 industrial shed, 5 flats,
      // 6 offices (ribbon glazing), 7 civic (tall windows), 8 tank (ribbed, no windows); tint 1-2 shutters, 3 Paris grey-blue, 5-9 sign colour
      float st = mod(vB.x, 10.0), tint = floor(vB.x / 10.0 + 0.01);
      float s1 = step(0.5, st) * step(st, 1.5), s2 = step(1.5, st) * step(st, 2.5), s3 = step(2.5, st) * step(st, 3.5);
      float s4 = step(3.5, st) * step(st, 4.5), s5 = step(4.5, st) * step(st, 5.5), s6 = step(5.5, st) * step(st, 6.5), s7 = step(6.5, st) * step(st, 7.5), s8 = step(7.5, st);
      float wallF = (1.0 - step(0.5, abs(vON.y))) * step(0.5, st);
      float rel = vWP.y - vB.y;
      float hz = dot(vWP.xz, normalize(vec2(-vON.z, vON.x) + 1e-5));
      float sp = s1 * 3.6 + s2 * 2.8 + s3 * 1.7 + s4 * 6.0 + s5 * 3.0 + s6 * 3.2 + s7 * 3.4 + (1.0 - s1 - s2 - s3 - s4 - s5 - s6 - s7) * 2.8;
      float fh = s1 * 2.9 + s2 * 3.3 + s3 * 3.3 + s4 * 5.0 + s5 * 3.0 + s6 * 3.6 + s7 * 3.9 + (1.0 - s1 - s2 - s3 - s4 - s5 - s6 - s7) * 3.3;
      vec2 cell = vec2(floor(hz / sp), floor(rel / fh));
      vec2 f = vec2(fract(hz / sp), fract(rel / fh));
      float shopF = s2 * step(rel, 4.2);
      vec4 bx = vec4(0.24, 0.76, 0.3, 0.8);
      bx = mix(bx, vec4(0.05, 0.95, 0.08, 0.94), s3);
      bx = mix(bx, vec4(0.06, 0.94, 0.12, 0.85), shopF); // shopfronts
      bx = mix(bx, vec4(0.04, 0.96, 0.62, 0.8), s4);
      bx = mix(bx, vec4(0.22, 0.78, 0.28, 0.78), s5);
      bx = mix(bx, vec4(-0.01, 1.01, 0.32, 0.84), s6);
      bx = mix(bx, vec4(0.3, 0.7, 0.16, 0.86), s7);
      bx = mix(bx, vec4(2.0, 2.0, 2.0, 2.0), s8); // tanks: no windows
      float win = wallF * step(bx.x, f.x) * step(f.x, bx.y) * step(bx.z, f.y) * step(f.y, bx.w) * step(0.4, rel);
      vec3 glass = mix(mix(mix(vec3(0.42, 0.47, 0.55), vec3(0.32, 0.36, 0.4), shopF), vec3(0.38, 0.5, 0.62), s3), vec3(0.36, 0.46, 0.56), s6);
      if (tint > 2.5 && tint < 4.5) glass = vec3(0.5, 0.55, 0.62);
      diffuseColor.rgb = mix(diffuseColor.rgb, (s3 + s6) > 0.5 ? glass : diffuseColor.rgb * glass, win * 0.88);
      // industrial sheds: ribbed metal cladding
      diffuseColor.rgb *= 1.0 - (s4 + s8) * wallF * 0.08 * step(0.5, fract(hz / 0.45));
      // a shop's sign band over the shopfront (higher up on a trade shed)
      float bandLo = mix(3.55, 4.6, s4);
      float band = wallF * step(4.5, tint) * step(bandLo, rel) * step(rel, bandLo + 0.8);
      vec3 signC = tint < 5.5 ? vec3(0.55, 0.11, 0.09) : tint < 6.5 ? vec3(0.12, 0.35, 0.22) : tint < 7.5 ? vec3(0.11, 0.2, 0.34) : tint < 8.5 ? vec3(0.77, 0.42, 0.07) : vec3(0.13, 0.13, 0.14);
      diffuseColor.rgb = mix(diffuseColor.rgb, signC, band);
      // shutters either side of the window (Mediterranean / Middle East)
      float shut = wallF * (1.0 - win) * step(0.5, tint) * step(tint, 2.5) * step(0.4, rel - 4.2)
        * (step(0.1, f.x) * step(f.x, 0.24) + step(0.76, f.x) * step(f.x, 0.9)) * step(bx.z, f.y) * step(f.y, bx.w);
      vec3 shutC = tint < 1.5 ? vec3(0.3, 0.45, 0.32) : vec3(0.48, 0.34, 0.22);
      diffuseColor.rgb = mix(diffuseColor.rgb, shutC, shut * 0.9);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * step(0.5, abs(vON.y)) * 0.8);
      float lit = win * step(shopF > 0.5 ? 0.3 : s6 > 0.5 ? 0.45 : 0.62, hsh(cell + floor(vWP.xz / 40.0))) * uNight;`)
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
