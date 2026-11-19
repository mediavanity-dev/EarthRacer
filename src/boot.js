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
}

(native ? startNative().catch((e) => console.warn('native start', e)) : Promise.resolve()).then(() => import('./main.js'));
