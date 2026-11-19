// The seatback map shown during every trip: the whole route fitted on screen, drawn once from
// low-detail map tiles, with your marker moving along it as time passes.

import { loadVectorTile } from '../data/tiles.js';
import { paintTile, tilePlaces, landColor } from './mapPaint.js';
import { lonToTileX, latToTileY } from '../geo.js';

const T = 256;

export class TripMap {
  constructor(canvas, trip, icon) {
    this.canvas = canvas;
    this.trip = trip;
    this.icon = icon;
    this.base = null;
    this.ready = false;
    this.cur = null;
  }

  // unwrap the destination so a route across the date line stays short
  toLon() { let l = this.trip.to.lon; const d = l - this.trip.from.lon; if (d > 180) l -= 360; else if (d < -180) l += 360; return l; }
  px(lat, lon, z) { return [lonToTileX(lon, z) * T, latToTileY(Math.max(-84, Math.min(84, lat)), z) * T]; }

  async draw() {
    const c = this.canvas, W = c.width, H = c.height;
    const { from, to } = this.trip, tl = this.toLon();
    const [x0, y0] = this.px(from.lat, from.lon, 0), [x1, y1] = this.px(to.lat, tl, 0);
    const dx = Math.max(Math.abs(x1 - x0), 1e-6), dy = Math.max(Math.abs(y1 - y0), 1e-6);
    const z = Math.max(1, Math.min(11, Math.floor(Math.log2(Math.min((W * 0.72) / dx, (H * 0.62) / dy)))));
    const [a0, b0] = this.px(from.lat, from.lon, z), [a1, b1] = this.px(to.lat, tl, z);
    this.z = z;
    this.ox = (a0 + a1) / 2 - W / 2; this.oy = (b0 + b1) / 2 - H / 2;
    const base = document.createElement('canvas'); base.width = W; base.height = H;
    const g = base.getContext('2d');
    g.fillStyle = landColor('map'); g.fillRect(0, 0, W, H);
    const n = 2 ** z;
    const tx0 = Math.floor(this.ox / T), tx1 = Math.floor((this.ox + W) / T), ty0 = Math.max(0, Math.floor(this.oy / T)), ty1 = Math.min(n - 1, Math.floor((this.oy + H) / T));
    const jobs = [], places = [];
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      if (jobs.length > 48) break;
      const wx = ((tx % n) + n) % n;
      jobs.push(loadVectorTile(z, wx, ty).catch(() => undefined).then((vt) => {
        if (vt === undefined) return;
        paintTile(g, vt, tx * T - this.ox, ty * T - this.oy, T, 'map');
        for (const p of tilePlaces(vt)) places.push({ ...p, x: tx * T - this.ox + p.x * T, y: ty * T - this.oy + p.y * T });
      }));
    }
    await Promise.all(jobs);
    // a few big place names, biggest first, never overlapping
    places.sort((p, q) => (p.cls === 'country' ? -1 : 0) - (q.cls === 'country' ? -1 : 0) || p.rank - q.rank);
    const boxes = [];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of places) {
      if (boxes.length > 14 || p.x < 20 || p.y < 12 || p.x > W - 20 || p.y > H - 12) continue;
      const big = p.cls === 'country' || p.cls === 'state';
      g.font = big ? '600 13px system-ui' : '12px system-ui';
      const w = g.measureText(p.name).width + 8;
      const box = [p.x - w / 2, p.y - 9, p.x + w / 2, p.y + 9];
      if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      boxes.push(box);
      g.fillStyle = big ? 'rgba(90,70,110,0.75)' : 'rgba(40,40,40,0.8)';
      if (!big) { g.beginPath(); g.arc(p.x, p.y + 8, 2, 0, Math.PI * 2); g.fill(); }
      g.fillText(big ? p.name.toUpperCase() : p.name, p.x, p.y);
    }
    this.base = base;
    this.ready = true;
    if (this.cur) this.update(this.cur.lat, this.cur.lon, this.cur.f);
  }

  /** Redraw the route and your marker at (lat, lon); f = 0..1 along the route. */
  update(lat, lon, f) {
    this.cur = { lat, lon, f };
    const c = this.canvas, g = c.getContext('2d');
    if (!this.ready) { g.fillStyle = landColor('map'); g.fillRect(0, 0, c.width, c.height); return; }
    g.drawImage(this.base, 0, 0);
    const P = (la, lo) => { const [x, y] = this.px(la, lo, this.z); return [x - this.ox, y - this.oy]; };
    const tl = this.toLon();
    const [ax, ay] = P(this.trip.from.lat, this.trip.from.lon), [bx, by] = P(this.trip.to.lat, tl);
    let lo = lon; if (lo - this.trip.from.lon > 180) lo -= 360; else if (lo - this.trip.from.lon < -180) lo += 360;
    const [cx, cy] = P(lat, lo);
    g.lineCap = 'round';
    g.setLineDash([7, 6]); g.strokeStyle = 'rgba(30,40,60,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    g.setLineDash([]); g.strokeStyle = '#e8590c'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(cx, cy); g.stroke();
    for (const [x, y, col] of [[ax, ay, '#2f6fb0'], [bx, by, '#1f6b3a']]) { g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke(); }
    // your marker
    g.fillStyle = '#fff'; g.strokeStyle = '#e8590c'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.fill(); g.stroke();
    g.font = '17px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(this.icon, cx, cy + 1);
    void f;
  }
}
