// Paints one vector tile onto a 2D canvas, in two looks:
//   'map'    - a clean seatback-style map (land, water, borders, big roads)
//   'ground' - the ground seen from a plane window (fields, woods, towns, water)
// Shared by the trip map and the window-seat view. Works at any zoom.

const STYLE = {
  map: {
    land: '#e9e4d6', water: '#9cc6e6',
    cover: { wood: '#cfe0bf', grass: '#dde8cc', farmland: '#e6e6c8', ice: '#f6f9fb', sand: '#efe2bf', wetland: '#d3e3d6', rock: '#ddd8cf' },
    urban: '#dcd3c6', road: '#f2b84b', roadW: 1.4, border: '#9a7fb0',
  },
  ground: {
    land: '#7f8f5c', water: '#2f5f86',
    cover: { wood: '#3f5f34', grass: '#7e9a55', farmland: '#a39a63', ice: '#eef3f6', sand: '#cdb987', wetland: '#5f7a5a', rock: '#8f8a80' },
    urban: '#8e8a82', road: '#6e6b66', roadW: 1, border: null,
  },
};
const MAJOR = new Set(['motorway', 'trunk', 'primary']);

export function landColor(look) { return STYLE[look].land; }

/** Draw vector tile `vt` into ctx at (ox, oy), `size` px square. */
export function paintTile(ctx, vt, ox, oy, size, look = 'map') {
  const st = STYLE[look];
  ctx.fillStyle = vt ? st.land : st.water; // no tile = open sea
  ctx.fillRect(ox, oy, size, size);
  if (!vt) return;
  const path = (f, close) => {
    const E = f.extent, s = size / E;
    ctx.beginPath();
    for (const ring of f.loadGeometry()) ring.forEach((p, k) => (k ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s)));
    if (close) ctx.closePath();
  };
  const each = (name, fn) => { const l = vt.layers[name]; if (l) for (let i = 0; i < l.length; i++) fn(l.feature(i)); };
  each('landcover', (f) => { const c = st.cover[f.properties.class]; if (c && f.type === 3) { ctx.fillStyle = c; path(f, true); ctx.fill('evenodd'); } });
  each('landuse', (f) => {
    const c = f.properties.class;
    if (f.type === 3 && (c === 'residential' || c === 'commercial' || c === 'industrial' || c === 'retail')) { ctx.fillStyle = st.urban; path(f, true); ctx.fill('evenodd'); }
  });
  each('water', (f) => { if (f.type === 3) { ctx.fillStyle = st.water; path(f, true); ctx.fill('evenodd'); } });
  each('waterway', (f) => { if (f.type === 2 && f.properties.class === 'river') { ctx.strokeStyle = st.water; ctx.lineWidth = 1.2; path(f); ctx.stroke(); } });
  ctx.lineCap = 'round';
  each('transportation', (f) => {
    if (f.type !== 2 || !MAJOR.has(f.properties.class)) return;
    ctx.strokeStyle = st.road; ctx.lineWidth = f.properties.class === 'motorway' ? st.roadW * 1.4 : st.roadW;
    path(f); ctx.stroke();
  });
  if (st.border) {
    ctx.setLineDash([4, 3]);
    each('boundary', (f) => {
      const lvl = +f.properties.admin_level;
      if (f.type !== 2 || lvl > 4 || f.properties.maritime === 1) return;
      ctx.strokeStyle = st.border; ctx.lineWidth = lvl <= 2 ? 1.6 : 0.7;
      path(f); ctx.stroke();
    });
    ctx.setLineDash([]);
  } else {
    // from the air: borders as faint dashed lines, like a watermark (countries, regions, towns)
    each('boundary', (f) => {
      const lvl = +f.properties.admin_level;
      if (f.type !== 2 || lvl > 8 || f.properties.maritime === 1) return;
      ctx.setLineDash(lvl <= 2 ? [10, 6] : lvl <= 4 ? [6, 5] : [3, 4]);
      ctx.strokeStyle = lvl <= 2 ? 'rgba(255,255,255,0.32)' : lvl <= 4 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.13)';
      ctx.lineWidth = lvl <= 2 ? 2.2 : lvl <= 4 ? 1.4 : 1;
      path(f); ctx.stroke();
    });
    ctx.setLineDash([]);
  }
}

/**
 * Faint, watermark-like labels painted into the ground itself (so they sit on the landscape, tilt
 * with it and never jump): seas and lakes, cities and towns, motorway numbers. Sparse on purpose:
 * `boxes` is shared across a whole mosaic so labels keep their distance from each other.
 */
export function paintGroundLabels(ctx, vt, ox, oy, size, boxes, max = 14, scale = 1) {
  if (!vt) return;
  const items = [];
  const pt = (f) => { const g = f.loadGeometry()[0]; return g && g.length ? g[Math.floor(g.length / 2)] : null; };
  const each = (name, fn) => { const l = vt.layers[name]; if (l) for (let i = 0; i < l.length; i++) fn(l.feature(i)); };
  each('water_name', (f) => {
    const p = f.properties, g = pt(f);
    if (!g || !p.name) return;
    const big = p.class === 'ocean' || p.class === 'sea';
    items.push({ text: p['name:en'] || p.name_en || p.name, x: g.x / f.extent, y: g.y / f.extent, kind: 'water', pri: big ? 0 : 2, size: big ? 30 : 17 });
  });
  each('place', (f) => {
    const p = f.properties, g = f.loadGeometry()[0]?.[0];
    if (!g || !p.name) return;
    const sizes = { country: 30, city: 22, town: 15 };
    if (!sizes[p.class] || (p.class === 'town' && (p.rank || 10) > 12)) return;
    items.push({ text: p.class === 'country' ? (p['name:en'] || p.name).toUpperCase() : (p['name:en'] || p.name_en || p.name), x: g.x / f.extent, y: g.y / f.extent, kind: p.class, pri: p.class === 'country' ? 0 : p.class === 'city' ? 1 : 3, size: sizes[p.class] });
  });
  const refs = new Set();
  each('transportation_name', (f) => {
    const p = f.properties;
    if (f.type !== 2 || !p.ref || (p.class !== 'motorway' && p.class !== 'trunk') || refs.has(p.ref)) return;
    const line = f.loadGeometry()[0];
    if (!line || line.length < 2) return;
    const m = Math.floor(line.length / 2), a = line[m - 1] || line[0], b = line[m];
    refs.add(p.ref);
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI; // keep text upright
    items.push({ text: p.ref.split(';')[0], x: b.x / f.extent, y: b.y / f.extent, kind: 'road', pri: 4, size: 13, ang });
  });
  items.sort((a, b) => a.pri - b.pri);
  for (const it of items) {
    if (boxes.length >= max) break;
    const x = ox + it.x * size, y = oy + it.y * size, fs = Math.round(it.size * scale);
    ctx.font = `${it.kind === 'water' ? 'italic 500' : it.kind === 'road' ? '700' : '600'} ${fs}px system-ui, sans-serif`;
    const w = ctx.measureText(it.text).width, h = fs;
    const pad = it.pri <= 1 ? 50 : 90; // smaller things need more room around them
    const box = [x - w / 2 - pad, y - h / 2 - pad, x + w / 2 + pad, y + h / 2 + pad];
    if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
    boxes.push(box);
    ctx.save();
    ctx.translate(x, y);
    if (it.ang) ctx.rotate(it.ang);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (it.kind === 'road') { // a small faint shield
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-w / 2 - 4, -h / 2 - 2, w + 8, h + 4);
    }
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.strokeText(it.text, 0, 0);
    ctx.fillStyle = it.kind === 'water' ? 'rgba(220,236,255,0.42)' : 'rgba(255,255,255,0.4)';
    ctx.fillText(it.text, 0, 0);
    ctx.restore();
  }
}

/** Big places in a tile, for labels: [{ name, x, y (0..1 of the tile), rank }] */
export function tilePlaces(vt) {
  const out = [];
  const l = vt?.layers.place;
  if (!l) return out;
  for (let i = 0; i < l.length; i++) {
    const f = l.feature(i), p = f.properties;
    if (!p.name || !['city', 'town', 'country', 'state'].includes(p.class)) continue;
    const g = f.loadGeometry()[0]?.[0];
    if (!g) continue;
    out.push({ name: p['name:en'] || p.name_en || p.name, x: g.x / f.extent, y: g.y / f.extent, cls: p.class, rank: p.rank || 10 });
  }
  return out;
}
