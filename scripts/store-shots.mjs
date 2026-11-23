// App Store screenshots (iPhone 6.9" landscape, 2868×1320): each scene is staged in the real game
// (dev server, headless Chrome, a 932×430 phone at 3× pixels), then framed with a caption.
//   npx vite --port 5186   (in another terminal)
//   node scripts/store-shots.mjs                 → fastlane/screenshots/en-US/*.png
//   SHOTS=portal,garage node scripts/store-shots.mjs   (just some)
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fastlane', 'screenshots', 'en-US');
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5186/';
const PROFILE = (mode, extra = {}) => ({ settings: { mode, controls: 'slider', cam: 0, traffic: 1 }, unlocked: { bike: true, car: true, pickup: true, moto: true, truck: true, boat: true, para: true }, coins: 1240, stats: { km: 412, deliveries: 9, races: 4, nearMiss: 31, overtakes: 50, drift: 120, air: 40, style: 18450, jumps: 14, stars: 22 }, ...extra });
const clean = `if (!document.querySelector('#shotcss')) { const c = document.createElement('style'); c.id = 'shotcss'; c.textContent = '#toasts, #sidepops { display: none !important; }'; document.head.appendChild(c); } for (const t of document.querySelectorAll('.toast, #sidepops .sp')) t.remove(); document.querySelector('#rotate').hidden = true;`;
const wait = `const wait = (ms) => new Promise((r) => setTimeout(r, ms));`;

// [file, headline, subline, url params, profile, staging JS run in the page]
const SCENES = [
  ['1-drive', 'Drive the real Earth', 'Every street, building and bridge, built live from open map data', 'hour=12&at=48.8606,2.3376', PROFILE('explorer'), `
    const { game } = window.__er; game.v.vf = 12; await wait(6000);`],
  ['2-portal', 'A portal opens once an hour', 'Follow the star, drive through, and see where you come out', 'hour=17&portal&at=44.4764,-73.2120', PROFILE('explorer'), `
    const { game, scene } = window.__er;
    for (let i = 0; i < 160 && !game.portal?.placed; i++) { const gp = game.portal; if (gp?.pos) { game.v.x = gp.pos.x + 20; game.v.z = gp.pos.z + 20; game.v.init = false; } await wait(500); }
    const pv = scene.children.find((o) => o.isGroup && o.children.length === 5 && o.children.some((c) => c.isSprite));
    const face = -pv.children[0].rotation.y, fx = Math.sin(face), fz = -Math.cos(face);
    game.v.x = pv.position.x - fx * 42; game.v.z = pv.position.z - fz * 42; game.v.heading = face; game.v.init = false; game.v.vx = game.v.vz = game.v.vf = 0;
    await wait(9000);`],
  ['3-gamer', 'Gamer mode: stunts everywhere', 'Ramps, coins, boost arrows, cones and signs to knock down', 'hour=12&at=48.8530,2.3499', PROFILE('gamer'), `
    const { game, world } = window.__er; await wait(4000);
    let best = null;
    for (const ch of world.readyChunks()) for (const o of ch.stunts?.boosts || []) { const x = ch.ox + o.x * ch.sx, z = ch.oz + o.z, d = Math.hypot(x - game.v.x, z - game.v.z); if (!best || d < best.d) best = { x, z, a: o.a, d }; }
    if (best) { const fx = Math.sin(best.a), fz = -Math.cos(best.a); game.v.x = best.x - fx * 14; game.v.z = best.z - fz * 14; game.v.heading = best.a; game.v.init = false; }
    await wait(5000);`],
  ['4-garage', 'Vehicles with real trade-offs', 'Speed, handling, toughness and fuel: pick the right one for the job', 'hour=12&at=51.5007,-0.1246', PROFILE('explorer'), `
    await wait(3000); document.querySelector('#b-menu').click(); await wait(800);`],
  ['5-mountain', 'Real places, real weather', "The Stelvio Pass at 2,758 m, in today's weather", 'hour=10&at=46.5287,10.4533', PROFILE('explorer'), `
    window.__er.game.cam = 1; await wait(7000);`],
  ['6-random', 'Where on Earth are you?', 'Get dropped somewhere with no labels, read the signs, and guess', 'hour=4&at=35.6595,139.7005', PROFILE('explorer', { random: { uses: [Date.now()], active: { lat: 35.6595, lon: 139.7005, start: Date.now() - 120000, km0: 412 }, history: [] } }), `
    await wait(7000);`],
];
const want = (process.env.SHOTS || '').split(',').filter(Boolean);

const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const W = 2868, H = 1320, appW = 2280, appH = Math.round(appW * 430 / 932), top = H - appH - 54;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const [file, head, sub, params, profile, js] of SCENES) {
  if (want.length && !want.some((w) => file.includes(w))) continue;
  const ctx = await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, locale: 'en-US', hasTouch: true });
  const page = await ctx.newPage();
  try {
    await page.addInitScript((p) => localStorage.setItem('earthracer-profile', JSON.stringify(p)), profile);
    await page.goto(`${BASE}?dev&timer&touch&${params}`);
    await page.waitForFunction(() => window.__er?.game.state === 'driving', null, { timeout: 120000 });
    await page.evaluate(`(async () => { ${wait} ${js} ${clean} })()`);
    await page.waitForTimeout(400);
    await page.evaluate(clean);
    const shot = await page.screenshot();
    const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${top}">
      <text x="${W / 2}" y="${top * 0.5}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-weight="800" font-size="78" fill="#eef1f4">${esc(head)}</text>
      <text x="${W / 2}" y="${top * 0.5 + 66}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="40" fill="#f4c430">${esc(sub)}</text></svg>`);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${appW}" height="${appH}"><rect width="${appW}" height="${appH}" rx="56" ry="56"/></svg>`);
    const app = await sharp(shot).resize(appW, appH).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const border = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${appW + 12}" height="${appH + 12}"><rect x="3" y="3" width="${appW + 6}" height="${appH + 6}" rx="60" ry="60" fill="none" stroke="#3a4250" stroke-width="6"/></svg>`);
    await sharp({ create: { width: W, height: H, channels: 3, background: '#0f1720' } })
      .composite([{ input: caption, left: 0, top: 0 }, { input: border, left: (W - appW) / 2 - 6, top: top - 6 }, { input: app, left: (W - appW) / 2, top }])
      .removeAlpha().png().toFile(join(out, `${file}.png`));
    console.log(`${file}: ok`);
  } catch (e) { console.error(`${file}: ${String(e).slice(0, 300)}`); }
  finally { await ctx.close(); }
}
await browser.close();
console.log(readdirSync(out).join(', '));
