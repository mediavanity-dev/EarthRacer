# EarthRacer on the App Store (iPhone)

The iPhone app is the same game as the website, bundled in a native shell with
[Capacitor](https://capacitorjs.com). Builds run on a GitHub-hosted Mac (no Mac needed). The repo
is public, so builds cost no Actions allowance. Set up from the `web-app-to-apple-app-store`
skill and OpenWorld's (OpenEarth's) working setup.

## Identifiers (permanent)

- Bundle ID: `com.mediavanity.earthracer`
- App Store name: **EarthRacer** (App Store Connect app ID 6836800392, SKU `earthracer-ios`)
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`); landscape and portrait
- Tip products (consumable): `com.mediavanity.earthracer.tip.small` ($0.99), `.tip.medium` ($2.99), `.tip.large` ($4.99)
- Age rating 12+ (live radio may have mild language); categories Games › Racing, Simulation

## What's in the repo

| Path | Purpose |
| --- | --- |
| `capacitor.config.json` | App ID, name, background colour |
| `scripts/build-www.mjs` | `npm run build:app`: the Vite build into `www/`; fails on remote scripts or analytics |
| `src/boot.js` | Entry point: in the app, restores the saved profile from native storage (Preferences) before the game starts. iOS can clear web storage, and your saved spot must survive |
| `ios/App/App/SceneDelegate.swift` | Full screen game view: no status bar, auto-hiding home indicator, screen-edge swipes deferred (thumbs on pedals), no zoom/scroll, dark background |
| `ios/App/App/Info.plist` | Location (only for "Start where I am") and motion (tilt steering) text; orientations |
| `ios/App/App/PrivacyInfo.xcprivacy` | Privacy manifest: no tracking, no data collected; UserDefaults (CA92.1) |
| `icons/icon.svg`, `scripts/make-icons.mjs` | App icon and launch screen (`npm run icons`) |
| `.github/workflows/ios-testflight.yml` | Builds on the `xcode-27` runner (iOS 27 SDK, required from April 2027), signs with Apple's cloud certificate, uploads to TestFlight |

**Runner:** the workflow asks which Mac to use. `xcode-27` (default) builds with the iOS 27 SDK that
Apple requires from April 2027. When Apple-silicon Macs are short (jobs sit queued, then get
cancelled after ~15 min with "not acquired by Runner … capacity constraints"), run it with
`gh workflow run ios-testflight.yml -f runner=macos-26-intel` (Xcode 26; fine until April 2027).

After changing web code: `npm run ios:sync`, commit, push, then **Actions → iOS → TestFlight →
Run workflow** (or `gh workflow run ios-testflight.yml`). The run number is the build number.

## Repository secrets (Settings → Secrets and variables → Actions)

The same four values as Alchemy, Standards and OpenEarth (secrets are per repo):
`APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the whole `.p8` file, including the
BEGIN/END lines). The values are in `Alchemy_AppStoreData` next to this project.

## TestFlight

Internal group **Team** with automatic distribution: every build reaches the account holder's
TestFlight app by itself. https://appstoreconnect.apple.com/apps/6836800392/testflight/ios

## Data sources (live, cached on the phone)

Same family as OpenEarth: OpenStreetMap via OpenFreeMap (ODbL, attribution on screen), AWS
terrain tiles, Open-Meteo weather and marine (free tier: non-commercial; fine for a free app),
Nominatim (1 request/second for the whole app; switch off remotely if asked), Wikipedia /
Wikimedia Commons (free licences only). Nothing about the player is sent anywhere.

## Store listing, screenshots and site

- Text, URLs, copyright and categories: `fastlane/metadata/`. Review notes:
  `fastlane/metadata/review_information/notes.txt` (entered in App Store Connect with the contact;
  the upload workflow leaves them out).
- Screenshots (iPhone 6.9" landscape, 2868×1320): start the dev server (`npx vite --port 5186`), then
  `node scripts/store-shots.mjs` → `fastlane/screenshots/en-US/`. Look at every one before uploading.
- Tip jar review screenshot: `fastlane/iap/tip-jar-review.png`.
- Upload: Actions → **App Store listing** → Run workflow (version 1.0).
- Support and privacy pages: https://mediavanity-dev.github.io/earthracer-app/ (repo `earthracer-app`).
- The tip jar is the app's own plugin (`ios/App/App/EarthRacerPlugin.swift`, registered in
  `SceneDelegate.swift`; JS side in `src/boot.js` and Settings in `src/main.js`). iPhone app only.

## Status

- 2026-11-23: version 1.0 submitted with build 15, then withdrawn and resubmitted the same day with
  build 17 (the latest) and the three tips. Release: **automatic** after approval. Price free,
  174 regions (not China mainland), age rating 9+ (12+ in Vietnam, Brazil, Korea), App Privacy
  "Data Not Collected" (published).
- 2026-11-25: 1.0 approved and live. Version bumped to **1.1** (`MARKETING_VERSION` in the Xcode
  project): build 19 is the first 1.1 build on TestFlight. A build for an approved version is refused
  ("train version '1.0' is closed"), so bump the version before the next round of builds.
- App Review contact is typed in App Store Connect (not kept in the repo).

