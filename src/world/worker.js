// Web Worker: builds one zoom-14 map tile (~1.5 km) into drivable geometry, off the main thread.
// Output is in metres around the tile centre (x = east, z = south, y = up).
//   - terrain mesh + painted ground texture (areas, roads, buildings from above)
//   - road ribbons with lane markings and bridge railings (crisp up close, at speed)
//   - roadside props: street lights in built-up areas, reflector posts on rural roads
//   - buildings (mesh + footprints for collisions), trees
//   - game data: roads (class, width, surface, heights), street names, places, water mask

import earcut from 'earcut';
import { loadBaseTile } from '../data/tiles.js';
import { loadBuildingDetail } from '../data/osm.js';
import { ensureTerrain, heightOr } from '../data/terrain.js';
import { hsl, treeInstance, packTrees } from './trees.js';
import { ROAD_CLASSES } from './roadClasses.js';
import { regionStyle, TALL_WALLS } from './region.js';
import { CHUNK_Z, chunkBounds, tileXToLon, tileYToLat, offsetMeters, rng, hashStr, haversine } from '../geo.js';

const AREA_COLORS = {
  residential: '#d9d5c6', commercial: '#d8d0cb', industrial: '#cdc8c1', campus: '#e0d7c2',
  farmland: '#cfd09a', grass: '#a9c98c', park: '#9cc380', pitch: '#86be80', cemetery: '#9fb992',
  scrub: '#98b578', wood: '#6f9f5e', wetland: '#97bfa9', sand: '#e8d9ab', rock: '#b8b2a6', ice: '#eef4f7', water: '#5f9cc9',
};
const AREA_ORDER = ['residential', 'commercial', 'industrial', 'campus', 'farmland', 'grass', 'park', 'pitch', 'cemetery', 'scrub', 'wood', 'wetland', 'sand', 'rock', 'ice', 'water'];
const URBAN = new Set(['residential', 'commercial', 'industrial', 'campus']);
const OPEN = new Set(['park', 'grass', 'pitch', 'farmland', 'scrub', 'sand']);
const GRID = 64;
const MASK = 256; // water/urban mask resolution (~6 m cells)

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'detail') { // OSM building detail for a tile (roof shapes, colours, materials, types)
      const d = await loadBuildingDetail(`${CHUNK_Z}/${msg.x}/${msg.y}`, chunkBounds(msg.x, msg.y));
      self.postMessage({ id: msg.id, ok: true, payload: d });
      return;
    }
    const { payload, transfer } = await build(msg);
    self.postMessage({ id: msg.id, ok: true, payload }, transfer);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
};

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  // sRGB hex -> linear (vertex colours are linear in the renderer; otherwise everything looks washed out)
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return [lin(n >> 16), lin((n >> 8) & 255), lin(n & 255)];
}
const namedCtx = new OffscreenCanvas(1, 1).getContext('2d');
function colourOf(v) {
  if (!v) return null;
  const h = hexRgb(v);
  if (h) return h;
  namedCtx.fillStyle = '#010203';
  namedCtx.fillStyle = String(v).trim().toLowerCase().replace(/[\s_-]/g, '');
  return namedCtx.fillStyle === '#010203' ? null : hexRgb(namedCtx.fillStyle);
}
const MATERIAL = { brick: '#9c5a43', stone: '#b3a68f', concrete: '#bdbab2', glass: '#8fb1c9', wood: '#a5774f', timber_framing: '#ead9bb', plaster: '#ece3d0', render: '#ece3d0', metal: '#a2a8ae', steel: '#a2a8ae', sandstone: '#d7bf8f', limestone: '#e2d8c0', cement_block: '#c6c2b8', marble: '#eeeae4', adobe: '#c9a27a', mud: '#b08a62', clay: '#c98a64' };
const ROOF_MATERIAL = { roof_tiles: '#a3402c', tile: '#a3402c', tiles: '#a3402c', slate: '#4d5258', metal: '#7f8a93', concrete: '#9a9893', asphalt_shingle: '#555a5e', asphalt: '#4a4c4f', tar_paper: '#3c3e40', thatch: '#b59a5c', glass: '#9fbccc', copper: '#5f9e86', wood: '#7a5a3e', stone: '#8c8880', grass: '#6e8f4e', gravel: '#9a968e', eternit: '#8a8c8e' };
const PITCHED = new Set(['gabled', 'hipped', 'pyramidal', 'half-hipped', 'gambrel', 'mansard', 'skillion', 'side_hipped', 'saltbox', 'dome', 'onion', 'cone', 'round']);
const HOUSE_T = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'farm', 'barn', 'farm_auxiliary', 'hut', 'garage', 'shed']);
const FLAT_T = new Set(['apartments', 'commercial', 'retail', 'office', 'industrial', 'warehouse', 'hospital', 'school', 'hotel', 'train_station', 'stadium', 'garages']);
const CHURCH_T = new Set(['church', 'cathedral', 'chapel', 'mosque', 'temple', 'synagogue', 'shrine']);
const shade = (c, f) => [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];

function inside(x, y, ring) {
  let c = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c;
  }
  return c;
}
const insidePoly = (x, y, rings) => inside(x, y, rings[0]) && !rings.slice(1).some((r) => inside(x, y, r));
function bbox(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
function ringArea(ring) {
  let a = 0;
  for (let k = 0, n = ring.length; k < n; k++) { const [x1, y1] = ring[k], [x2, y2] = ring[(k + 1) % n]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}

async function build({ x, y, opts }) {
  const b = chunkBounds(x, y);
  const [fabric] = await Promise.all([loadBaseTile(CHUNK_Z, x, y), ensureTerrain(b)]);
  const E = fabric.extent;
  const latc = tileYToLat(y + 0.5, CHUNK_Z), lonc = tileXToLon(x + 0.5, CHUNK_Z);
  const latOf = (py) => tileYToLat(y + py / E, CHUNK_Z);
  const lonOf = (px) => tileXToLon(x + px / E, CHUNK_Z);
  const tileM = haversine(latc, b.w, latc, b.e);
  const mPerPx = tileM / E;
  const seed = hashStr(`${x}/${y}`);

  // ---------- height grid (row 0 = north edge); triangle-exact sampling, same as the mesh ----------
  const W = GRID + 1;
  const grid = new Float32Array(W * W);
  const fb = heightOr(latc, lonc, 0);
  for (let r = 0; r <= GRID; r++) for (let c = 0; c <= GRID; c++) grid[r * W + c] = heightOr(latOf((r / GRID) * E), lonOf((c / GRID) * E), fb);
  const H = (px, py) => {
    const gx = Math.min(GRID - 1e-6, Math.max(0, (px / E) * GRID)), gy = Math.min(GRID - 1e-6, Math.max(0, (py / E) * GRID));
    const c0 = Math.floor(gx), r0 = Math.floor(gy), fx = gx - c0, fy = gy - r0;
    const h00 = grid[r0 * W + c0], h01 = grid[r0 * W + c0 + 1], h10 = grid[(r0 + 1) * W + c0], h11 = grid[(r0 + 1) * W + c0 + 1];
    return fx + fy <= 1 ? h00 + (h01 - h00) * fx + (h10 - h00) * fy : h11 + (h10 - h11) * (1 - fx) + (h01 - h11) * (1 - fy);
  };
  const lutN = 1024;
  const lutX = new Float32Array(lutN + 1), lutZ = new Float32Array(lutN + 1);
  for (let k = 0; k <= lutN; k++) {
    lutX[k] = offsetMeters(latc, lonc, latc, lonOf((k / lutN) * E)).x;
    lutZ[k] = offsetMeters(latc, lonc, latOf((k / lutN) * E), lonc).z;
  }
  const lut = (t, v) => { const f = Math.min(lutN, Math.max(0, (v / E) * lutN)); const i = Math.min(lutN - 1, Math.floor(f)); return t[i] + (t[i + 1] - t[i]) * (f - i); };
  const X = (px) => lut(lutX, px), Z = (py) => lut(lutZ, py);
  const xs = new Float32Array(W), zs = new Float32Array(W);
  for (let k = 0; k <= GRID; k++) { xs[k] = X((k / GRID) * E); zs[k] = Z((k / GRID) * E); }

  // ---------- terrain mesh ----------
  const tPos = new Float32Array(W * W * 3), tUv = new Float32Array(W * W * 2);
  for (let r = 0; r <= GRID; r++) for (let c = 0; c <= GRID; c++) {
    const k = r * W + c;
    tPos[k * 3] = xs[c]; tPos[k * 3 + 1] = grid[k]; tPos[k * 3 + 2] = zs[r];
    tUv[k * 2] = c / GRID; tUv[k * 2 + 1] = r / GRID;
  }

  // ---------- ground texture ----------
  const TEX = opts.tex || 1024, s = TEX / E;
  const canvas = new OffscreenCanvas(TEX, TEX);
  const g = canvas.getContext('2d');
  g.fillStyle = '#cdd3bd';
  g.fillRect(0, 0, TEX, TEX);
  const areas = fabric.areas.slice().sort((a, c) => AREA_ORDER.indexOf(a.cls) - AREA_ORDER.indexOf(c.cls));
  const trace = (ctx, rings, sc) => { ctx.beginPath(); for (const ring of rings) ring.forEach(([px, py], k) => (k ? ctx.lineTo(px * sc, py * sc) : ctx.moveTo(px * sc, py * sc))); };
  const strokeOn = (ctx, pts, sc) => { ctx.beginPath(); pts.forEach(([px, py], k) => (k ? ctx.lineTo(px * sc, py * sc) : ctx.moveTo(px * sc, py * sc))); ctx.stroke(); };
  for (const a of areas) { g.fillStyle = AREA_COLORS[a.cls]; trace(g, a.rings, s); g.fill('evenodd'); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const texPerM = TEX / tileM;
  for (const ln of fabric.lines) {
    if (ln.cls === 'road') continue; // roads are real geometry
    g.lineWidth = Math.max(1, ln.width * texPerM);
    g.setLineDash(ln.cls === 'rail' ? [6, 4] : []);
    g.strokeStyle = ln.cls === 'path' ? '#ddd5c4' : ln.cls === 'rail' ? '#7f7a74' : AREA_COLORS.water;
    strokeOn(g, ln.pts, s);
  }
  g.setLineDash([]);
  // road shoulders (a dusty verge under the road ribbons hides seams at junctions)
  g.strokeStyle = '#b9b2a2';
  for (const rd of fabric.roads) { if (rd.cls === 'path') continue; g.lineWidth = Math.max(1.5, (rd.width + 3) * texPerM); strokeOn(g, rd.pts, s); }
  g.fillStyle = 'rgba(90,85,75,0.3)';
  for (const bd of fabric.buildings) { trace(g, bd.rings, s); g.fill('evenodd'); }
  const texture = canvas.transferToImageBitmap();

  // ---------- masks: water (bit 1), built-up (bit 2) ----------
  const mc = new OffscreenCanvas(MASK, MASK);
  const mg = mc.getContext('2d', { willReadFrequently: true });
  const ms = MASK / E;
  mg.fillStyle = '#000'; mg.fillRect(0, 0, MASK, MASK);
  mg.fillStyle = '#f00';
  for (const a of fabric.areas) if (a.cls === 'water') { trace(mg, a.rings, ms); mg.fill('evenodd'); }
  mg.strokeStyle = '#f00'; mg.lineCap = 'round';
  for (const ln of fabric.lines) if (ln.cls === 'river' && ln.width >= 9) { mg.lineWidth = ln.width / mPerPx * ms; strokeOn(mg, ln.pts, ms); }
  mg.globalCompositeOperation = 'lighter';
  mg.fillStyle = '#0f0';
  for (const a of fabric.areas) if (URBAN.has(a.cls)) { trace(mg, a.rings, ms); mg.fill('evenodd'); }
  mg.fillStyle = '#00f';
  for (const a of fabric.areas) if (a.cls === 'industrial') { trace(mg, a.rings, ms); mg.fill('evenodd'); }
  const md = mg.getImageData(0, 0, MASK, MASK).data;
  // open land you could take off from (parks, grass, fields, pitches, scrub, sand), minus buildings
  const oc = new OffscreenCanvas(MASK, MASK), og = oc.getContext('2d', { willReadFrequently: true });
  og.fillStyle = '#000'; og.fillRect(0, 0, MASK, MASK); og.fillStyle = '#fff';
  for (const a of fabric.areas) if (OPEN.has(a.cls)) { trace(og, a.rings, ms); og.fill('evenodd'); }
  og.fillStyle = '#000';
  for (const bd of fabric.buildings) { trace(og, bd.rings, ms); og.fill('evenodd'); }
  const od = og.getImageData(0, 0, MASK, MASK).data;
  const mask = new Uint8Array(MASK * MASK);
  for (let k = 0; k < mask.length; k++) mask[k] = (md[k * 4] > 127 ? 1 : 0) | (md[k * 4 + 1] > 127 ? 2 : 0) | (md[k * 4 + 2] > 127 ? 4 : 0) | (od[k * 4] > 127 ? 8 : 0);
  const maskAt = (px, py) => { const c = Math.floor(px * ms), r = Math.floor(py * ms); return c >= 0 && r >= 0 && c < MASK && r < MASK ? mask[r * MASK + c] : 0; };
  // the elevation data includes the sea floor: water is drawn (and sailed) at the surface
  for (let r = 0; r <= GRID; r++) for (let c = 0; c <= GRID; c++) {
    const k = r * W + c;
    if (grid[k] < 0.5) {
      const px = Math.min(E - 1, (c / GRID) * E), py = Math.min(E - 1, (r / GRID) * E);
      let wet = false;
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) if (maskAt(px + dx * E / MASK * 2, py + dy * E / MASK * 2) & 1) wet = true;
      if (wet || grid[k] < -15) { grid[k] = 0.5; tPos[k * 3 + 1] = 0.5; }
    }
  }

  // ---------- buildings: regional colours, pitched roofs on houses, window styles ----------
  // Per-vertex "aB" = [window style, ground height] for the building shader:
  //   style 0 none (roofs, gables), 1 house, 2 apartments/shops, 3 glass tower, 4 warehouse;
  //   + 10 x tint (0 dark glass, 1 green shutters, 2 brown shutters, 3 grey-blue Paris windows)
  const style = regionStyle(opts.region || 'generic');
  const pal = (list, v) => hexRgb(list[Math.floor(v * list.length) % list.length]) || [0.85, 0.83, 0.8];
  const pos = [], nrm = [], col = [], win = [];
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, cl, cb = cl, cc = cl, ws = 0, wb = 0) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    col.push(...cl, ...cb, ...cc);
    win.push(ws, wb, ws, wb, ws, wb);
  };
  const footprints = [];
  const fpPts = [], fpIdx = [];
  for (const bd of fabric.buildings) {
    const outer = bd.rings[0];
    let ground = Infinity, cx = 0, cy = 0;
    for (const [px, py] of outer) { ground = Math.min(ground, H(px, py)); cx += px; cy += py; }
    cx /= outer.length; cy /= outer.length;
    const rr = rng(seed ^ hashStr(`${Math.round(cx)},${Math.round(cy)}`));
    const r = rr();
    const areaM = ringArea(outer) * mPerPx * mPerPx;
    // real OSM detail when we have it (roof shape, colours, materials, type), else regional guesses
    const det = opts.detail && bd.way ? opts.detail[bd.way] : null;
    const ty = det?.t || null;
    const tall = bd.height > 30;
    const industrial = ty ? ty === 'industrial' || ty === 'warehouse' : !tall && areaM > 1500 && bd.height < 16 && (maskAt(cx, cy) & 4) !== 0;
    const church = ty ? CHURCH_T.has(ty) : false;
    const house = ty ? HOUSE_T.has(ty) && areaM < 1200 : !tall && !industrial && bd.height <= 12 && areaM < 450;
    const realWall = colourOf(det?.c) || hexRgb(MATERIAL[det?.m]) || hexRgb(bd.colour);
    const base = realWall || (church ? pal(['#c9bfae', '#d8cfbd', '#b9ae9a'], rr()) : ty === 'barn' ? hexRgb('#8b2e22') : tall ? pal(TALL_WALLS, rr()) : industrial ? pal(['#c9c6be', '#b8bcbf', '#d4cfc4', '#a9b0b3'], rr()) : pal(style.walls, rr()));
    const wallC = shade(base, 0.92 + r * 0.12), lowC = shade(wallC, 0.86);
    const ws = church ? 1 : (tall ? 3 : industrial ? 4 : house ? 1 : 2) + (tall || industrial ? 0 : style.tint * 10);
    const shape = det?.s || null;
    const shapeOk = outer.length >= 4 && outer.length <= 24 && bd.rings.length === 1 && !(bd.minHeight > 0);
    const pitched = shapeOk && shape !== 'flat' && (PITCHED.has(shape) || church || (!shape && house && outer.length <= 10 && rr() < style.pitched) || (!shape && ty && HOUSE_T.has(ty) && outer.length <= 12));
    const realRoof = colourOf(det?.rc) || hexRgb(ROOF_MATERIAL[det?.rm]);
    const roofC = realRoof || (pitched ? shade(pal(style.roofs, rr()), 0.95 + r * 0.1) : tall ? shade(base, 0.8) : shade([0.62, 0.62, 0.6], 0.9 + r * 0.2));
    const top = ground + bd.height;
    const bottom = bd.minHeight > 0 ? ground + bd.minHeight : ground - 1.5;
    // local corner points
    const P = outer.map(([px, py]) => [X(px), Z(py)]);
    let rh = 0;
    if (pitched) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      rh = det?.rh || Math.max(1.2, Math.min(church ? 9 : 4, Math.min(x1 - x0, z1 - z0) * (church ? 0.6 : 0.32)));
    }
    const wallTop = pitched ? Math.max(ground + 2.6, top - rh) : top;
    const roofTop = wallTop + rh;
    for (const ring of bd.rings) {
      for (let k = 0; k < ring.length; k++) {
        const [p1x, p1y] = ring[k], [p2x, p2y] = ring[(k + 1) % ring.length];
        const x1 = X(p1x), z1 = Z(p1y), x2 = X(p2x), z2 = Z(p2y);
        tri(x1, bottom, z1, x2, bottom, z2, x2, wallTop, z2, lowC, lowC, wallC, ws, ground);
        tri(x1, bottom, z1, x2, wallTop, z2, x1, wallTop, z1, lowC, wallC, wallC, ws, ground);
      }
    }
    if (!pitched) {
      const flat = [], holes = [];
      for (const ring of bd.rings) { if (flat.length) holes.push(flat.length / 2); for (const [px, py] of ring) flat.push(X(px), Z(py)); }
      const idx = earcut(flat, holes);
      for (let k = 0; k < idx.length; k += 3) {
        const a = idx[k] * 2, bb = idx[k + 1] * 2, c = idx[k + 2] * 2;
        tri(flat[a], top, flat[a + 1], flat[bb], top, flat[bb + 1], flat[c], top, flat[c + 1], roofC);
      }
    } else if (P.length === 4) {
      // gable roof: ridge runs along the longer sides
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const o = d(P[0], P[1]) >= d(P[1], P[2]) ? 0 : 1;
      const A = P[o], B = P[(o + 1) % 4], C = P[(o + 2) % 4], D = P[(o + 3) % 4];
      const m1 = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2], m2 = [(D[0] + A[0]) / 2, (D[1] + A[1]) / 2];
      const roofD = shade(roofC, 0.82);
      tri(A[0], wallTop, A[1], B[0], wallTop, B[1], m1[0], roofTop, m1[1], roofC);
      tri(A[0], wallTop, A[1], m1[0], roofTop, m1[1], m2[0], roofTop, m2[1], roofC);
      tri(C[0], wallTop, C[1], D[0], wallTop, D[1], m2[0], roofTop, m2[1], roofD);
      tri(C[0], wallTop, C[1], m2[0], roofTop, m2[1], m1[0], roofTop, m1[1], roofD);
      tri(B[0], wallTop, B[1], C[0], wallTop, C[1], m1[0], roofTop, m1[1], wallC);
      tri(D[0], wallTop, D[1], A[0], wallTop, A[1], m2[0], roofTop, m2[1], wallC);
    } else {
      // hipped (pyramid) roof
      let ax = 0, az = 0; for (const [x, z] of P) { ax += x; az += z; } ax /= P.length; az /= P.length;
      for (let k = 0; k < P.length; k++) {
        const a = P[k], b = P[(k + 1) % P.length];
        tri(a[0], wallTop, a[1], b[0], wallTop, b[1], ax, roofTop, az, shade(roofC, k % 2 ? 0.85 : 1));
      }
    }
    footprints.push({ ring: outer, bb: bbox(outer), top: roofTop });
    // only solid-from-the-ground buildings block vehicles (not bridges over roads, canopies)
    if (!(bd.minHeight > 2)) { fpIdx.push(fpPts.length / 2); for (const [px, py] of outer) fpPts.push(X(px), Z(py)); }
  }
  fpIdx.push(fpPts.length / 2);
  const buildings = pos.length ? { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col), win: new Float32Array(win) } : null;

  // ---------- fine road occupancy (props never stand on a road) ----------
  const FN = 1024, fcell = E / FN, fine = new Uint8Array(FN * FN);
  const paint = (pts, halfM) => {
    const rad = Math.max(0, Math.ceil(halfM / mPerPx / fcell));
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / fcell));
      for (let t = 0; t <= steps; t++) {
        const c0 = Math.floor((ax + ((bx - ax) * t) / steps) / fcell), r0 = Math.floor((ay + ((by - ay) * t) / steps) / fcell);
        for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++) if (r >= 0 && c >= 0 && r < FN && c < FN) fine[r * FN + c] = 1;
      }
    }
  };
  for (const rd of fabric.roads) paint(rd.pts, rd.width / 2 + 0.6);
  for (const ln of fabric.lines) if (ln.cls === 'rail' || ln.cls === 'river') paint(ln.pts, ln.width / 2);
  const onWay = (px, py) => { const c = Math.floor(px / fcell), r = Math.floor(py / fcell); return c < 0 || r < 0 || c >= FN || r >= FN || fine[r * FN + c] === 1; };

  // ---------- road ribbons, markings, bridge railings ----------
  const rPos = [], rCol = [], rNrm = [];
  const quad = (a, b, c, d, cl, n = [0, 1, 0]) => { // wound so the front face points along n
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * n[0] + gy * n[1] + gz * n[2] < 0) { const t = b; b = d; d = t; }
    rPos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) { rCol.push(...cl); rNrm.push(...n); }
  };
  const ASPHALT = { motorway: [0.4, 0.4, 0.42], trunk: [0.41, 0.41, 0.43], primary: [0.43, 0.43, 0.45], secondary: [0.45, 0.45, 0.46], tertiary: [0.47, 0.47, 0.48], minor: [0.5, 0.5, 0.51], service: [0.54, 0.53, 0.52], pedestrian: [0.62, 0.58, 0.52] };
  const CENTRE = hexRgb(regionStyle(opts.region || 'generic').line) || [0.93, 0.93, 0.9];
  const DIRT = [0.55, 0.47, 0.36], PATHC = [0.72, 0.64, 0.5], WHITE = [0.93, 0.93, 0.9], RAIL = [0.7, 0.71, 0.73];
  const LIFT = { motorway: 0.34, trunk: 0.33, primary: 0.32, secondary: 0.31, tertiary: 0.3, minor: 0.28, service: 0.26, pedestrian: 0.25, track: 0.24, path: 0.22 };
  const roads = []; // game data: { c, w, f, name?, p: Float32Array [x,y,z,...] }
  const props = { lamp: [], post: [] };
  const rand = rng(seed ^ 0x5bd1e995);
  const MAXPROPS = opts.maxProps ?? 1400;

  for (const rd of fabric.roads) {
    // densify to <= 8 m and convert to local metres
    const L = [];
    for (let k = 0; k < rd.pts.length; k++) {
      const [px, py] = rd.pts[k];
      if (k) {
        const [qx, qy] = rd.pts[k - 1];
        const segM = Math.hypot(px - qx, py - qy) * mPerPx, n = Math.ceil(segM / 8);
        for (let t = 1; t < n; t++) L.push([qx + ((px - qx) * t) / n, qy + ((py - qy) * t) / n]);
      }
      L.push([px, py]);
    }
    if (L.length < 2) continue;
    const lift = LIFT[rd.cls] ?? 0.25;
    let hs = L.map(([px, py]) => H(px, py) + lift);
    // real roads are smooth: average out elevation-data noise along the road (~40 m window),
    // never sinking more than a little into the ground
    if (!rd.bridge && hs.length > 2) {
      for (let pass = 0; pass < 3; pass++) {
        const sm = hs.slice();
        for (let k = 1; k < hs.length - 1; k++) {
          const a = Math.max(0, k - 2), b = Math.min(hs.length - 1, k + 2);
          let sum = 0; for (let q = a; q <= b; q++) sum += hs[q];
          sm[k] = sum / (b - a + 1);
        }
        hs = sm;
      }
      hs = hs.map((h, k) => Math.max(h, H(L[k][0], L[k][1]) + lift - 0.22));
    }
    if (rd.bridge) { // a bridge deck runs straight between its ends, never below the ground
      const h0 = hs[0], h1 = hs[hs.length - 1];
      let tot = 0; const acc = [0];
      for (let k = 1; k < L.length; k++) { tot += Math.hypot(L[k][0] - L[k - 1][0], L[k][1] - L[k - 1][1]); acc.push(tot); }
      hs = hs.map((h, k) => Math.max(h, h0 + (h1 - h0) * (acc[k] / (tot || 1))));
    }
    const P = L.map(([px, py], k) => [X(px), hs[k], Z(py)]);
    const flatPath = rd.cls === 'path' || rd.cls === 'pedestrian';
    const ci = ROAD_CLASSES.indexOf(rd.cls);
    const flat = new Float32Array(P.length * 3);
    P.forEach((p, k) => flat.set(p, k * 3));
    roads.push({ c: ci < 0 ? 5 : ci, w: rd.width, f: (rd.unpaved ? 1 : 0) | (rd.bridge ? 2 : 0) | (rd.oneway ? 4 : 0) | (rd.ramp ? 8 : 0), p: flat });

    // per-vertex side vectors (mitred, limited)
    const side = P.map((p, k) => {
      const a = P[Math.max(0, k - 1)], c = P[Math.min(P.length - 1, k + 1)];
      let dx = c[0] - a[0], dz = c[2] - a[2];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      return [-dz, dx]; // left of travel (x east, z south): rotate dir by +90° around y
    });
    const hw = rd.width / 2;
    const color = rd.cls === 'path' ? PATHC : rd.unpaved ? DIRT : (ASPHALT[rd.cls] || ASPHALT.minor);
    const tint = 0.97 + rand() * 0.06;
    const cl = shade(color, tint);
    const off = (p, sd, d, dy = 0) => [p[0] + sd[0] * d, p[1] + dy, p[2] + sd[1] * d];
    if (!flatPath) for (let k = 1; k < P.length; k++) {
      const a = P[k - 1], c = P[k], sa = side[k - 1], sc = side[k];
      quad(off(a, sa, -hw), off(c, sc, -hw), off(c, sc, hw), off(a, sa, hw), cl);
    }
    // arc length along the road (for dashes and prop spacing)
    const acc = [0];
    for (let k = 1; k < P.length; k++) acc.push(acc[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][2] - P[k - 1][2]));
    const at = (d) => { // point + side vector at distance d along the road
      let k = 1; while (k < P.length - 1 && acc[k] < d) k++;
      const t = Math.min(1, Math.max(0, (d - acc[k - 1]) / ((acc[k] - acc[k - 1]) || 1)));
      const a = P[k - 1], c = P[k];
      return { p: [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t], s: side[k - 1], k };
    };
    const total = acc[acc.length - 1];
    if (flatPath || rd.unpaved) continue;

    // markings: dashed centre line on two-way roads, solid edge lines on big roads
    const ML = 0.05; // above the asphalt
    const dashed = (offset, on, gap, w, clr) => {
      for (let d = on * 0.5; d + on < total; d += on + gap) {
        const A = at(d), B = at(d + on);
        quad(off(A.p, A.s, offset - w / 2, ML), off(B.p, B.s, offset - w / 2, ML), off(B.p, B.s, offset + w / 2, ML), off(A.p, A.s, offset + w / 2, ML), clr);
      }
    };
    if (!rd.oneway && rd.width >= 6 && rd.cls !== 'service' && rd.cls !== 'pedestrian') dashed(0, 3, rd.cls === 'minor' ? 6 : 5, 0.16, CENTRE);
    if (MAJOR.has(rd.cls) && rd.width >= 8) { dashed(hw - 0.45, 12, 0.01, 0.14, WHITE); dashed(-hw + 0.45, 12, 0.01, 0.14, WHITE); }
    if (rd.oneway && rd.width >= 10) dashed(0, 4, 8, 0.14, WHITE); // lane divider on dual carriageways

    // bridge railings + a deck skirt
    if (rd.bridge) {
      for (let k = 1; k < P.length; k++) {
        const a = P[k - 1], c = P[k], sa = side[k - 1], sc = side[k];
        for (const sg of [-1, 1]) {
          const a0 = off(a, sa, sg * hw), c0 = off(c, sc, sg * hw);
          const n = [sa[0] * sg, 0, sa[1] * sg];
          const up = (q, h) => [q[0], q[1] + h, q[2]];
          if (sg > 0) { quad(a0, c0, up(c0, 1.0), up(a0, 1.0), RAIL, n); quad(up(a0, -1.6), up(c0, -1.6), c0, a0, shade(RAIL, 0.7), n); }
          else { quad(c0, a0, up(a0, 1.0), up(c0, 1.0), RAIL, n); quad(up(c0, -1.6), up(a0, -1.6), a0, c0, shade(RAIL, 0.7), n); }
        }
      }
      continue;
    }

    // roadside props
    if (props.lamp.length + props.post.length >= MAXPROPS || rd.cls === 'service' || rd.cls === 'pedestrian') continue;
    const mid = at(total / 2);
    const [mpx, mpy] = L[Math.min(L.length - 1, mid.k)];
    const urban = (maskAt(mpx, mpy) & 2) !== 0 || footprintsNear(mpx, mpy);
    if (urban) {
      const spacing = rd.cls === 'minor' ? 38 : 32;
      for (let d = spacing * (0.3 + rand() * 0.7), sg = 1; d < total; d += spacing, sg = MAJOR.has(rd.cls) ? -sg : sg) {
        const A = at(d), q = off(A.p, A.s, sg * (hw + 1.2));
        const [ppx, ppy] = pxOf(q);
        if (onWay(ppx, ppy)) continue;
        props.lamp.push(q[0], H(ppx, ppy), q[2], Math.atan2(A.s[1] * sg, -A.s[0] * sg));
      }
    } else if (MAJOR.has(rd.cls) || rd.cls === 'minor') {
      for (let d = 10 + rand() * 20; d < total; d += 50) {
        const A = at(d);
        for (const sg of [-1, 1]) {
          const q = off(A.p, A.s, sg * (hw + 1.0));
          const [ppx, ppy] = pxOf(q);
          if (onWay(ppx, ppy) || (maskAt(ppx, ppy) & 1)) continue;
          props.post.push(q[0], H(ppx, ppy), q[2], Math.atan2(A.s[0], A.s[1]));
        }
      }
    }
  }
  function footprintsNear(px, py) { // a few buildings within ~60 m = built-up even without a landuse area
    const R = 60 / mPerPx; let n = 0;
    for (const f of footprints) if (f.bb.x1 > px - R && f.bb.x0 < px + R && f.bb.y1 > py - R && f.bb.y0 < py + R && ++n >= 3) return true;
    return false;
  }
  // local metres -> tile px (inverse LUT, binary search)
  function inv(t, v) {
    let lo = 0, hi = lutN;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= v) lo = m; else hi = m; }
    const f = (v - t[lo]) / ((t[hi] - t[lo]) || 1);
    return ((lo + f) / lutN) * E;
  }
  function pxOf(q) { return [inv(lutX, q[0]), inv(lutZ, q[2])]; }

  const roadMesh = rPos.length ? { pos: new Float32Array(rPos), col: new Float32Array(rCol), nrm: new Float32Array(rNrm) } : null;

  // ---------- trees in woods and parks (never on roads, water or buildings) ----------
  const season = opts.season;
  const DENS = { wood: 110, scrub: 260, park: 1500, cemetery: 900 };
  const blobs = [], cones = [];
  const maxTrees = opts.maxTrees || 4000;
  const evergreenShare = Math.abs(latc) > 55 ? 0.6 : 0.22;
  const blockers = footprints.map((f) => ({ rings: [f.ring], bb: f.bb }));
  const blocked = (px, py) => onWay(px, py) || (maskAt(px, py) & 1) || blockers.some((o) => px >= o.bb.x0 && px <= o.bb.x1 && py >= o.bb.y0 && py <= o.bb.y1 && insidePoly(px, py, o.rings));
  for (let ai = 0; ai < fabric.areas.length && blobs.length + cones.length < maxTrees; ai++) {
    const a = fabric.areas[ai];
    const dens = DENS[a.cls];
    if (!dens) continue;
    const bb0 = bbox(a.rings[0]);
    const bb = { x0: Math.max(0, bb0.x0), y0: Math.max(0, bb0.y0), x1: Math.min(E, bb0.x1), y1: Math.min(E, bb0.y1) };
    if (bb.x1 <= bb.x0 || bb.y1 <= bb.y0) continue;
    const areaM = Math.min((bb.x1 - bb.x0) * (bb.y1 - bb.y0), ringArea(a.rings[0])) * mPerPx * mPerPx;
    const n = Math.min(maxTrees - blobs.length - cones.length, Math.round(areaM / dens));
    const rr = rng(seed ^ (ai * 2654435761));
    for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
      const px = bb.x0 + rr() * (bb.x1 - bb.x0), py = bb.y0 + rr() * (bb.y1 - bb.y0);
      if (!insidePoly(px, py, a.rings) || blocked(px, py)) continue;
      const small = a.cls === 'scrub';
      const radius = small ? 0.9 + rr() * 0.9 : 2 + rr() * 2.4;
      const evergreen = !small && a.cls === 'wood' && rr() < evergreenShare;
      (evergreen ? cones : blobs).push(treeInstance(X(px), H(px, py), Z(py), radius, evergreen ? 'evergreen-needle' : 'deciduous', season, rr));
      k++;
    }
  }

  // ---------- places (shops, cafés, landmarks, fuel) ----------
  const PRIORITY = { tourism: 0, historic: 0, fuel: 0, natural: 1, leisure: 1, transport: 1, amenity: 2, shop: 2 };
  const pois = fabric.pois
    .map((p) => ({ p, k: (PRIORITY[p.kind.split(':')[0]] ?? 3) * 1000 + (p.rank || 99) }))
    .sort((a, c) => a.k - c.k).slice(0, 400)
    .map(({ p }) => ({ ref: p.ref, name: p.name, nameEn: p.nameEn || null, kind: p.kind, x: X(p.px), z: Z(p.py), y: H(p.px, p.py), lat: latOf(p.py), lon: lonOf(p.px) }));

  // ---------- street names: polylines in local metres ----------
  const streets = [];
  for (const st of fabric.streets || []) {
    const out = [];
    for (const [px, py] of st.pts) out.push(X(px), Z(py));
    if (out.length >= 4) streets.push({ name: st.name, ref: st.ref, network: st.network, cls: st.cls, p: new Float32Array(out) });
  }

  // ---------- names of water and places, for faint labels in trip views ----------
  const labels = [];
  for (const w of fabric.waterNames || []) labels.push({ kind: 'water', name: w.name, x: X(w.px), z: Z(w.py) });
  for (const a of fabric.areas) if (a.cls === 'water' && a.name && ringArea(a.rings[0]) * mPerPx * mPerPx > 40000) {
    const r0 = a.rings[0]; let sx = 0, sy = 0; for (const [px, py] of r0) { sx += px; sy += py; }
    labels.push({ kind: 'water', name: a.name, x: X(sx / r0.length), z: Z(sy / r0.length) });
  }
  for (const pl of fabric.places || []) labels.push({ kind: pl.cls, name: pl.name, x: X(pl.px), z: Z(pl.py) });

  // ---------- public transport you can board (bus, train, ferry, plane) ----------
  const stops = (fabric.stops || []).slice(0, 400).map((s) => ({ kind: s.kind, name: s.name, x: X(s.px), z: Z(s.py), lat: latOf(s.py), lon: lonOf(s.px) }));

  const payload = {
    key: `${CHUNK_Z}/${x}/${y}`, x, y, bounds: b, latc, lonc, areaName: fabric.areaName,
    gridN: GRID, grid, xs, zs, maskN: MASK, mask, mPerMask: tileM / MASK,
    terrain: { pos: tPos, uv: tUv }, texture,
    buildings, roadMesh, fp: { pts: new Float32Array(fpPts), idx: new Uint32Array(fpIdx) },
    lamps: new Float32Array(props.lamp), posts: new Float32Array(props.post),
    trees: packTrees(blobs), cones: packTrees(cones),
    roads, streets, pois, stops, labels,
  };
  const transfer = [grid.buffer, xs.buffer, zs.buffer, mask.buffer, tPos.buffer, tUv.buffer, texture, payload.fp.pts.buffer, payload.fp.idx.buffer, payload.lamps.buffer, payload.posts.buffer];
  if (buildings) transfer.push(buildings.pos.buffer, buildings.nrm.buffer, buildings.col.buffer, buildings.win.buffer);
  if (roadMesh) transfer.push(roadMesh.pos.buffer, roadMesh.col.buffer, roadMesh.nrm.buffer);
  for (const t of [payload.trees, payload.cones]) if (t) transfer.push(t.mat.buffer, t.col.buffer, t.trunk.buffer);
  for (const r of roads) transfer.push(r.p.buffer);
  for (const st of streets) transfer.push(st.p.buffer);
  return { payload, transfer };
}
