# EarthRacer on the App Store (iPhone)

The iPhone app is the same game as the website, bundled in a native shell with
[Capacitor](https://capacitorjs.com). Builds run on a GitHub-hosted Mac (no Mac needed). The repo
is public, so builds cost no Actions allowance. Set up from the `web-app-to-apple-app-store`
skill and OpenWorld's (OpenEarth's) working setup.

## Identifiers (permanent)

- Bundle ID: `com.mediavanity.earthracer`
- App Store name: **EarthRacer** (App Store Connect app ID 6836800392, SKU `earthracer-ios`)
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`); landscape and portrait

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

## Still to do before App Store submission

Listing text and screenshots, support and privacy pages, App Privacy ("no data collected"), age
rating, price (free), review notes (how to play without travelling: pick any start, or a random
placement).
