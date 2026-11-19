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
