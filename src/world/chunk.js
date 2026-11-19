// One loaded map tile on the main thread: three.js meshes plus the queries a vehicle needs
// (ground height, road under the wheels, buildings to bump into, water, street names).
// Everything here is in tile-local metres; the World places the tile in the scene.

import * as THREE from 'three';
import { terrainMat, roadMat, buildingMat, treeMat, trunkMat, treeGeo, coneGeo, trunkGeo, lampGeo, lampHeadGeo, postGeo, lampMat, lampHeadMat, postMat } from './materials.js';

const CELL = 40; // spatial index cell (m)

export function makeChunk(p, { anisotropy = 4 } = {}) {
  const group = new THREE.Group();
  const disposables = [];
  const add = (mesh) => { group.add(mesh); disposables.push(mesh.geometry); return mesh; };

  // terrain
  const tex = new THREE.Texture(p.texture);
  tex.flipY = false; tex.anisotropy = anisotropy; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const N = p.gridN, W = N + 1;
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(p.terrain.pos, 3));
  tg.setAttribute('uv', new THREE.BufferAttribute(p.terrain.uv, 2));
  const index = new Uint32Array(N * N * 6);
  let q = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const a = r * W + c, b = (r + 1) * W + c, d = r * W + c + 1, e = (r + 1) * W + c + 1;
    index[q++] = a; index[q++] = b; index[q++] = d; // same split as the worker's height sampler
    index[q++] = b; index[q++] = e; index[q++] = d;
  }
  tg.setIndex(new THREE.BufferAttribute(index, 1));
  tg.computeVertexNormals();
  const terrainMesh = add(new THREE.Mesh(tg, terrainMat(tex)));
  terrainMesh.receiveShadow = false;

  if (p.roadMesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.roadMesh.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.roadMesh.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(p.roadMesh.col, 3));
    add(new THREE.Mesh(g, roadMat));
  }
  if (p.buildings) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.buildings.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(p.buildings.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(p.buildings.col, 3));
    g.setAttribute('aB', new THREE.BufferAttribute(p.buildings.win, 2));
    add(new THREE.Mesh(g, buildingMat));
  }
  const m4 = new THREE.Matrix4();
  for (const [t, geo] of [[p.trees, treeGeo], [p.cones, coneGeo]]) {
    if (!t) continue;
    const crowns = new THREE.InstancedMesh(geo, treeMat, t.n);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, t.n);
    const col = new THREE.Color();
    for (let k = 0; k < t.n; k++) {
      crowns.setMatrixAt(k, m4.fromArray(t.mat, k * 16));
      trunks.setMatrixAt(k, m4.fromArray(t.trunk, k * 16));
      crowns.setColorAt(k, col.setRGB(t.col[k * 3], t.col[k * 3 + 1], t.col[k * 3 + 2]));
    }
    group.add(crowns, trunks);
  }
  const quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const lamps = [];
  for (const [arr, geos, list] of [[p.lamps, [[lampGeo, lampMat], [lampHeadGeo, lampHeadMat]], lamps], [p.posts, [[postGeo, postMat]], null]]) {
    const n = arr.length / 4;
    if (!n) continue;
    const ims = geos.map(([geo, mat]) => new THREE.InstancedMesh(geo, mat, n));
    for (let k = 0; k < n; k++) {
      quat.setFromAxisAngle(up, arr[k * 4 + 3]);
      m4.compose(v.set(arr[k * 4], arr[k * 4 + 1], arr[k * 4 + 2]), quat, one);
      for (const im of ims) im.setMatrixAt(k, m4);
      list?.push([arr[k * 4], arr[k * 4 + 2]]);
    }
    group.add(...ims);
  }

  // ---------- spatial index: roads (segments), buildings, street names ----------
  const half = Math.max(Math.abs(p.xs[0]), Math.abs(p.xs[N]), Math.abs(p.zs[0]), Math.abs(p.zs[N])) + 80;
  const G = Math.ceil((half * 2) / CELL);
  const cellOf = (x, z) => {
    const c = Math.floor((x + half) / CELL), r = Math.floor((z + half) / CELL);
    return c < 0 || r < 0 || c >= G || r >= G ? -1 : r * G + c;
  };
  const segCells = new Map(), bldCells = new Map(), nameCells = new Map();
  const put = (map, cell, val) => { if (cell < 0) return; let l = map.get(cell); if (!l) map.set(cell, (l = [])); l.push(val); };
  const cover = (map, x0, z0, x1, z1, pad, val) => {
    const c0 = Math.floor((Math.min(x0, x1) - pad + half) / CELL), c1 = Math.floor((Math.max(x0, x1) + pad + half) / CELL);
    const r0 = Math.floor((Math.min(z0, z1) - pad + half) / CELL), r1 = Math.floor((Math.max(z0, z1) + pad + half) / CELL);
    for (let r = Math.max(0, r0); r <= Math.min(G - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(G - 1, c1); c++) put(map, r * G + c, val);
  };
  p.roads.forEach((rd, ri) => {
    const a = rd.p;
    for (let k = 3; k < a.length; k += 3) cover(segCells, a[k - 3], a[k - 1], a[k], a[k + 2], rd.w / 2 + 2, ri * 4096 + k / 3);
  });
  const fp = p.fp;
  const nB = fp.idx.length - 1;
  const bBox = new Float32Array(nB * 4);
  for (let b = 0; b < nB; b++) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = fp.idx[b]; k < fp.idx[b + 1]; k++) { const x = fp.pts[k * 2], z = fp.pts[k * 2 + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    bBox.set([x0, z0, x1, z1], b * 4);
    cover(bldCells, x0, z0, x1, z1, 3, b);
  }
  p.streets.forEach((st, si) => {
    const a = st.p;
    for (let k = 2; k < a.length; k += 2) cover(nameCells, a[k - 2], a[k - 1], a[k], a[k + 1], 12, si * 65536 + k / 2);
  });

  // ---------- road graph: shared vertices are junctions (for traffic and races) ----------
  const vkey = (x, z) => `${Math.round(x / 2)},${Math.round(z / 2)}`;
  const nodes = new Map(); // key -> [{ r, i }]
  p.roads.forEach((rd, ri) => {
    if (rd.c >= 7) return; // tracks/paths/pedestrian: no traffic
    const a = rd.p;
    for (let i = 0; i < a.length / 3; i++) {
      const k = vkey(a[i * 3], a[i * 3 + 2]);
      let l = nodes.get(k); if (!l) nodes.set(k, (l = [])); l.push({ r: ri, i });
    }
  });
  for (const [k, l] of nodes) if (l.length < 2) nodes.delete(k);

  const chunk = {
    key: p.key, x: p.x, y: p.y, bounds: p.bounds, latc: p.latc, lonc: p.lonc, areaName: p.areaName,
    group, roads: p.roads, streets: p.streets, pois: p.pois, stops: p.stops || [], labels: p.labels || [], lamps, half,
    junctionAt(x, z) { return nodes.get(vkey(x, z)) || null; },
    /** All junctions of drivable roads: [[{ r, i }, ...], ...] */
    junctions() { return [...nodes.values()]; },
    /**
     * Roads to continue onto from (x, z): shared vertices first, plus (for the many road ends that
     * don't share an exact point after tile simplification) any drivable road within ~6 m.
     * -> [{ r, i }] (i = the vertex to continue from on road r)
     */
    linksAt(x, z, fromR, maxClass = 5) {
      const out = [];
      const seen = new Set();
      for (const o of nodes.get(vkey(x, z)) || []) if (o.r !== fromR && p.roads[o.r].c <= maxClass) { out.push(o); seen.add(o.r); }
      const l = segCells.get(cellOf(x, z));
      if (l) for (const id of l) {
        const ri = Math.floor(id / 4096), k = id % 4096, rd = p.roads[ri];
        if (ri === fromR || seen.has(ri) || rd.c > maxClass) continue;
        const a = rd.p, ax = a[k * 3 - 3], az = a[k * 3 - 1], bx = a[k * 3], bz = a[k * 3 + 2];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) > 6) continue;
        seen.add(ri);
        out.push({ r: ri, i: t < 0.5 ? k - 1 : k });
      }
      return out;
    },

    heightAt(x, z) {
      const c = search(p.xs, x), r = search(p.zs, z);
      const fx = Math.min(1, Math.max(0, (x - p.xs[c]) / (p.xs[c + 1] - p.xs[c]))), fy = Math.min(1, Math.max(0, (z - p.zs[r]) / (p.zs[r + 1] - p.zs[r])));
      const g = p.grid, h00 = g[r * W + c], h01 = g[r * W + c + 1], h10 = g[(r + 1) * W + c], h11 = g[(r + 1) * W + c + 1];
      return fx + fy <= 1 ? h00 + (h01 - h00) * fx + (h10 - h00) * fy : h11 + (h10 - h11) * (1 - fx) + (h01 - h11) * (1 - fy);
    },
    contains(x, z, m = 0) { return x >= p.xs[0] - m && x <= p.xs[N] + m && z >= p.zs[0] - m && z <= p.zs[N] + m; },
    isWater(x, z) {
      const c = Math.floor(((x - p.xs[0]) / (p.xs[N] - p.xs[0])) * p.maskN), r = Math.floor(((z - p.zs[0]) / (p.zs[N] - p.zs[0])) * p.maskN);
      return c >= 0 && r >= 0 && c < p.maskN && r < p.maskN && (p.mask[r * p.maskN + c] & 1) === 1;
    },
    /** Open land (park, grass, field, pitch…) with no water or building: somewhere to take off from. */
    isOpen(x, z) {
      const c = Math.floor(((x - p.xs[0]) / (p.xs[N] - p.xs[0])) * p.maskN), r = Math.floor(((z - p.zs[0]) / (p.zs[N] - p.zs[0])) * p.maskN);
      return c >= 0 && r >= 0 && c < p.maskN && r < p.maskN && (p.mask[r * p.maskN + c] & 9) === 8;
    },
    isUrban(x, z) {
      const c = Math.floor(((x - p.xs[0]) / (p.xs[N] - p.xs[0])) * p.maskN), r = Math.floor(((z - p.zs[0]) / (p.zs[N] - p.zs[0])) * p.maskN);
      return c >= 0 && r >= 0 && c < p.maskN && r < p.maskN && (p.mask[r * p.maskN + c] & 2) === 2;
    },
    /** Nearest road within `maxD` m: { road, ri, seg, d, t, y, dirX, dirZ, side } or null. */
    roadAt(x, z, maxD = 30, filter = null) {
      const l = segCells.get(cellOf(x, z));
      let best = null;
      if (!l) return null;
      for (const id of l) {
        const ri = Math.floor(id / 4096), k = id % 4096, rd = p.roads[ri];
        if (filter && !filter(rd)) continue;
        const a = rd.p, ax = a[k * 3 - 3], ay = a[k * 3 - 2], az = a[k * 3 - 1], bx = a[k * 3], by = a[k * 3 + 1], bz = a[k * 3 + 2];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz) - rd.w / 2;
        if (d < maxD && (!best || d < best.d)) {
          const L = Math.sqrt(L2);
          best = { road: rd, ri, seg: k, d, t, y: ay + (by - ay) * t, dirX: dx / L, dirZ: dz / L, px, pz, side: (x - px) * (-dz / L) + (z - pz) * (dx / L) };
        }
      }
      return best;
    },
    /** Push a circle (x, z, radius) out of buildings. Returns { x, z, nx, nz, depth } or null. */
    collide(x, z, rad) {
      const l = bldCells.get(cellOf(x, z));
      if (!l) return null;
      let hit = null;
      for (const b of l) {
        if (x < bBox[b * 4] - rad || x > bBox[b * 4 + 2] + rad || z < bBox[b * 4 + 1] - rad || z > bBox[b * 4 + 3] + rad) continue;
        const s = fp.idx[b], e = fp.idx[b + 1];
        let inside = false, bestD = Infinity, bx = 0, bz = 0;
        for (let i = s, j = e - 1; i < e; j = i++) {
          const xi = fp.pts[i * 2], zi = fp.pts[i * 2 + 1], xj = fp.pts[j * 2], zj = fp.pts[j * 2 + 1];
          if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
          const dx = xj - xi, dz = zj - zi, L2 = dx * dx + dz * dz || 1;
          const t = Math.min(1, Math.max(0, ((x - xi) * dx + (z - zi) * dz) / L2));
          const px = xi + dx * t, pz = zi + dz * t, d = Math.hypot(x - px, z - pz);
          if (d < bestD) { bestD = d; bx = px; bz = pz; }
        }
        if (!inside && bestD >= rad) continue;
        let nx = x - bx, nz = z - bz;
        const L = Math.hypot(nx, nz) || 1;
        nx /= L; nz /= L;
        if (inside) { nx = -nx; nz = -nz; }
        const depth = inside ? bestD + rad : rad - bestD;
        if (!hit || depth > hit.depth) hit = { x: x + nx * depth, z: z + nz * depth, nx, nz, depth };
      }
      return hit;
    },
    /**
     * The street-facing wall of the building at/near (x, z), for a shop sign: the wall nearest the
     * road point (rx, rz). -> { x, z, nx, nz } (outward normal) or null.
     */
    facade(x, z, rx, rz) {
      const l = bldCells.get(cellOf(x, z));
      if (!l) return null;
      let bestB = -1, bestD = 14;
      for (const b of l) {
        const s = fp.idx[b], e = fp.idx[b + 1];
        let inside = false, dmin = Infinity;
        for (let i = s, j = e - 1; i < e; j = i++) {
          const xi = fp.pts[i * 2], zi = fp.pts[i * 2 + 1], xj = fp.pts[j * 2], zj = fp.pts[j * 2 + 1];
          if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
          const dx = xj - xi, dz = zj - zi, L2 = dx * dx + dz * dz || 1;
          const t = Math.min(1, Math.max(0, ((x - xi) * dx + (z - zi) * dz) / L2));
          dmin = Math.min(dmin, Math.hypot(x - xi - dx * t, z - zi - dz * t));
        }
        const d = inside ? 0 : dmin;
        if (d < bestD) { bestD = d; bestB = b; }
      }
      if (bestB < 0) return null;
      const s = fp.idx[bestB], e = fp.idx[bestB + 1];
      let best = null;
      for (let i = s, j = e - 1; i < e; j = i++) {
        const xi = fp.pts[i * 2], zi = fp.pts[i * 2 + 1], xj = fp.pts[j * 2], zj = fp.pts[j * 2 + 1];
        const dx = xj - xi, dz = zj - zi, L = Math.hypot(dx, dz);
        if (L < 3) continue; // too narrow for a sign
        const t = Math.min(0.85, Math.max(0.15, ((rx - xi) * dx + (rz - zi) * dz) / (L * L)));
        const px = xi + dx * t, pz = zi + dz * t, d = Math.hypot(rx - px, rz - pz);
        if (!best || d < best.d) {
          let nx = -dz / L, nz = dx / L;
          if ((rx - px) * nx + (rz - pz) * nz < 0) { nx = -nx; nz = -nz; }
          best = { d, x: px, z: pz, nx, nz, w: L };
        }
      }
      return best;
    },
    /** Name of the street at (x, z), if any within ~12 m. */
    streetAt(x, z) { return this.streetInfoAt(x, z)?.name || null; },
    /** { name, ref, network } of the street at (x, z): the named one if any, else a numbered road. */
    streetInfoAt(x, z) {
      const l = nameCells.get(cellOf(x, z));
      if (!l) return null;
      let best = null, bd = 14, ref = null, net = null;
      for (const id of l) {
        const si = Math.floor(id / 65536), k = id % 65536, a = p.streets[si].p;
        const ax = a[k * 2 - 2], az = a[k * 2 - 1], bx = a[k * 2], bz = a[k * 2 + 1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        const st = p.streets[si];
        if (d < bd && st.name) { bd = d; best = st.name; }
        if (d < 14 && st.ref && !ref) { ref = st.ref; net = st.network; }
      }
      return best || ref ? { name: best, ref, network: net } : null;
    },
    /**
     * Where differently named streets cross or meet (T-junctions), found geometrically once per
     * tile: [{ x, z, names: [[name, [dx, dz]], [name, [dx, dz]]] }]
     */
    nameJunctions() {
      if (this._nj) return this._nj;
      const out = [], seen = new Set();
      const seg = (si, k) => { const a = p.streets[si].p; return [a[k * 2 - 2], a[k * 2 - 1], a[k * 2], a[k * 2 + 1]]; };
      const add = (x, z, na, da, nb, db) => {
        const key = `${Math.round(x / 15)},${Math.round(z / 15)}|${[na, nb].sort().join('|')}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ x, z, names: [[na, da], [nb, db]] });
      };
      for (const l of nameCells.values()) {
        for (let u = 0; u < l.length; u++) {
          const sa = Math.floor(l[u] / 65536), ka = l[u] % 65536, A = p.streets[sa];
          if (!A.name) continue;
          const [ax, az, bx, bz] = seg(sa, ka);
          for (let w = u + 1; w < l.length; w++) {
            const sb = Math.floor(l[w] / 65536), kb = l[w] % 65536, B = p.streets[sb];
            if (!B.name || B.name === A.name) continue;
            const [cx, cz, ex, ez] = seg(sb, kb);
            const r1x = bx - ax, r1z = bz - az, r2x = ex - cx, r2z = ez - cz;
            const den = r1x * r2z - r1z * r2x;
            const la = Math.hypot(r1x, r1z) || 1, lb = Math.hypot(r2x, r2z) || 1;
            const da = [r1x / la, r1z / la], db = [r2x / lb, r2z / lb];
            if (Math.abs(den) > 1e-6) {
              const t = ((cx - ax) * r2z - (cz - az) * r2x) / den, s2 = ((cx - ax) * r1z - (cz - az) * r1x) / den;
              // crossing, or one street ending within ~8 m of the other (a T-junction)
              const ta = 8 / la, tb = 8 / lb;
              if (t >= -ta && t <= 1 + ta && s2 >= -tb && s2 <= 1 + tb) add(ax + r1x * t, az + r1z * t, A.name, da, B.name, db);
            }
          }
        }
      }
      return (this._nj = out);
    },
    streetNames() { return [...new Set(p.streets.map((s) => s.name).filter(Boolean))]; },
    dispose() {
      for (const g of disposables) g.dispose();
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      terrainMesh.material.dispose();
      tex.dispose();
      p.texture.close?.();
    },
  };
  return chunk;
}

function search(arr, v) { // index of the cell containing v in a sorted array
  let lo = 0, hi = arr.length - 1;
  if (v <= arr[0]) return 0;
  if (v >= arr[hi]) return hi - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; }
  return lo;
}
