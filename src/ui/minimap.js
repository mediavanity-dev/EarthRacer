// Heading-up minimap. Each map tile is drawn once into a small image (roads + water); the map
// then just rotates and places those images, so it costs almost nothing per frame.

const IMG = 384;
const RADIUS_M = 420;

function tileImage(ch) {
  if (ch.mapImg) return ch.mapImg;
  const c = document.createElement('canvas');
  c.width = c.height = IMG;
  const g = c.getContext('2d');
  const x0 = -ch.half + 80, span = (ch.half - 80) * 2; // tile-local metres covered by the image
  const s = IMG / span;
  // water from the mask isn't kept on the chunk API; draw roads only (cheap and clear)
  g.lineCap = 'round'; g.lineJoin = 'round';
  const order = ch.roads.map((r, i) => i).sort((a, b) => ch.roads[b].c - ch.roads[a].c);
  for (const i of order) {
    const rd = ch.roads[i];
    if (rd.c >= 8) { g.strokeStyle = '#8d7f66'; g.lineWidth = 1; }
    else if (rd.c <= 1) { g.strokeStyle = '#f4c430'; g.lineWidth = Math.max(2.5, rd.w * s); }
    else if (rd.c <= 4) { g.strokeStyle = '#f2f2f2'; g.lineWidth = Math.max(2, rd.w * s); }
    else { g.strokeStyle = '#b8c0c8'; g.lineWidth = Math.max(1.5, rd.w * s); }
    if (rd.f & 2) g.strokeStyle = '#9ad0ff';
    g.beginPath();
    for (let k = 0; k < rd.p.length; k += 3) {
      const x = (rd.p[k] - x0) * s, y = (rd.p[k + 2] - x0) * s;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  ch.mapImg = { canvas: c, x0, span };
  return ch.mapImg;
}

export function drawMinimap(canvas, world, player, markers = [], { hideFuel = false } = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, R = W / 2;
  const s = R / RADIUS_M;
  g.clearRect(0, 0, W, H);
  g.save();
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#25313c'; g.fillRect(0, 0, W, H);
  g.translate(R, R);
  g.rotate(-player.heading);
  g.scale(s, s);
  for (const ch of world.readyChunks()) {
    const dx = ch.ox - player.x, dz = ch.oz - player.z;
    if (Math.abs(dx) > ch.half + RADIUS_M * 1.5 || Math.abs(dz) > ch.half + RADIUS_M * 1.5) continue;
    const im = tileImage(ch);
    g.drawImage(im.canvas, dx + im.x0 * ch.sx, dz + im.x0, im.span * ch.sx, im.span);
  }
  // markers in world coords
  for (const m of markers) {
    let mx = m.x - player.x, mz = m.z - player.z;
    const d = Math.hypot(mx, mz), lim = RADIUS_M * 0.92;
    const edge = d > lim;
    if (edge) { mx *= lim / d; mz *= lim / d; }
    g.save();
    g.translate(mx, mz);
    g.rotate(player.heading);
    g.fillStyle = m.color || '#ff5b5b';
    g.strokeStyle = '#000'; g.lineWidth = 2 / s;
    g.beginPath(); g.arc(0, 0, (m.size || 7) / s, 0, Math.PI * 2); g.fill(); g.stroke();
    if (m.label) { g.fillStyle = '#fff'; g.font = `bold ${11 / s}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(m.label, 0, 0.5 / s); }
    g.restore();
  }
  if (!hideFuel) {
    for (const ch of world.readyChunks()) {
      for (const p of ch.pois) {
        if (!/^fuel/.test(p.kind)) continue;
        const mx = ch.ox + p.x * ch.sx - player.x, mz = p.z + ch.oz - player.z;
        if (Math.hypot(mx, mz) > RADIUS_M) continue;
        g.save(); g.translate(mx, mz); g.rotate(player.heading);
        g.font = `${14 / s}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⛽', 0, 0);
        g.restore();
      }
    }
  }
  g.restore();
  // player arrow (always pointing up)
  g.fillStyle = '#4ea3ff'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(R, R - 11); g.lineTo(R + 8, R + 8); g.lineTo(R, R + 4); g.lineTo(R - 8, R + 8); g.closePath(); g.fill(); g.stroke();
  // north marker
  const nx = R + Math.sin(-player.heading) * (R - 12), ny = R - Math.cos(-player.heading) * (R - 12);
  g.fillStyle = '#ff6b5b'; g.font = 'bold 18px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('N', nx, ny);
}
