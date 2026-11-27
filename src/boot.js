// Entry point. In the iPhone app, the saved profile is restored from native storage first: iOS
// can clear a web view's storage (low space, updates), and losing your spot would break the
// game's main rule. In a browser the game starts straight away.

const KEY = 'earthracer-profile';
const native = !!window.Capacitor?.isNativePlatform?.();

async function startNative() {
  const { Preferences } = await import('@capacitor/preferences');
  const { value } = await Preferences.get({ key: KEY });
  let local = null;
  try { local = localStorage.getItem(KEY); } catch { /* blocked */ }
  // the newer of the two wins (each save stamps the time)
  const at = (s) => { try { return JSON.parse(s)?.savedAt || 0; } catch { return 0; } };
  if (value && (!local || at(value) > at(local))) { try { localStorage.setItem(KEY, value); } catch { /* blocked */ } }
  window.__nativeSave = (json) => { Preferences.set({ key: KEY, value: json }).catch(() => {}); };
  document.documentElement.classList.add('native');
  // the app's own plugin: the tip jar (a Capacitor plugin proxy answers to `then`, so never await it)
  const { registerPlugin } = await import('@capacitor/core');
  const raw = registerPlugin('EarthRacer');
  window.__tipJar = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : raw[k]) });
  // Android back button/gesture: press a visible Back/close button, else act like Escape (the game
  // menu). Without a handler, Android closes the game from any screen.
  if (window.Capacitor?.getPlatform?.() === 'android') {
    const App = registerPlugin('App'); // @capacitor/app
    App.addListener('backButton', () => {
      for (const s of ['#back', '#wback', '.close']) {
        const el = document.querySelector(s);
        if (el && el.offsetParent !== null) { el.click(); return; }
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' }));
    }).catch(() => {});
  }
  // one location fix through iOS itself, so its prompt names the app (the web view's says "localhost")
  window.__nativeLocate = () => raw.locate();
}

(native ? startNative().catch((e) => console.warn('native start', e)) : Promise.resolve()).then(() => import('./main.js'));
