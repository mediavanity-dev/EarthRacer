// Local radio: real internet radio stations for the country you're in, from the free, open
// Radio Browser directory (radio-browser.info). Only https streams (the iPhone app refuses plain
// http), most-listened first. Playing is a plain <audio> element: nothing to decode ourselves.

import { cachedJson } from './cache.js';

const API = 'https://all.api.radio-browser.info/json/stations/search';
const DAI = /streamtheworld|tritondigital|adswizz|ihrhls|iheart|revma|audacy|amperwave|streamguys.*adw|cdnstream1\.com|spreaker/i;

/** Up to 25 playable stations for a country code, most popular first. */
export async function stationsFor(cc) {
  const url = `${API}?countrycode=${encodeURIComponent(cc)}&order=clickcount&reverse=true&limit=80&hidebroken=true&is_https=true`;
  const list = await cachedJson(`radio:${cc}`, url, { ttl: 24 * 3600 * 1000 });
  const seen = new Set();
  return (list || []).filter((s) => {
    const u = s.url_resolved || s.url || '';
    const name = (s.name || '').trim();
    if (!u.startsWith('https://') || !name || seen.has(name.toLowerCase())) return false;
    if (s.codec && !/mp3|aac/i.test(s.codec)) return false;
    // no adult stations (the app is rated 12+ for the odd swear word on live radio, not for these)
    if (/\b(adult|erotic|sex|xxx|porn|nsfw|explicit|18\+)\b/i.test(`${name} ${s.tags || ''}`)) return false;
    seen.add(name.toLowerCase());
    return true;
  })
    // Stations on these streaming networks swap in adverts chosen from the listener's own internet
    // address, so in the game you'd hear adverts from where you really are. Keep them, but last.
    .map((st, i) => ({ st, i, dai: DAI.test(st.url_resolved || st.url || '') }))
    .sort((a, b) => a.dai - b.dai || a.i - b.i).map((x) => x.st)
    .slice(0, 25).map((s) => ({ name: s.name.trim(), url: s.url_resolved || s.url, tags: s.tags || '', homepage: s.homepage || '' }));
}

export class Radio {
  constructor(onChange) {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.volume = 0.8;
    this.list = []; this.cc = null; this.i = -1; this.on = false; this.fails = 0;
    this.onChange = onChange || (() => {});
    this.audio.addEventListener('playing', () => { this.fails = 0; this.onChange(); });
    this.audio.addEventListener('error', () => { if (this.on && ++this.fails < 6) this.next(); else if (this.on) this.stop('No station would play'); });
  }
  get station() { return this.on ? this.list[this.i] : null; }

  /** Turn on, or go to the next station. Must be called from a tap (autoplay rules). */
  async next(cc) {
    if (cc && cc !== this.cc) { this.cc = cc; this.list = []; this.i = -1; }
    if (!this.list.length) {
      this.list = await stationsFor(this.cc || 'US').catch(() => []);
      if (!this.list.length) { this.stop('No radio stations found here'); return; }
    }
    this.i = (this.i + 1) % this.list.length;
    this.on = true;
    this.audio.src = this.list[this.i].url;
    this.audio.play().catch(() => {});
    this.onChange();
  }
  stop(msg) { this.on = false; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.onChange(msg); }
}
