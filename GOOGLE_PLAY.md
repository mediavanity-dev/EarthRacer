# Google Play runbook

How EarthRacer gets from this repo to Google Play. The iOS side is in APP_STORE.md; the method is the
`web-app-to-google-play` skill (~/.claude/skills/web-app-to-google-play), whose references/sources.md
lists every Google rule with its official page.

## Fixed facts

| | |
| --- | --- |
| Play title | EarthRacer |
| Package name (permanent) | `com.mediavanity.earthracer` (same as the iOS bundle ID) |
| Developer account | mediavanity-dev, personal account (12 testers × 14 days closed test before production) |
| In-app products | `com.mediavanity.earthracer.tip.small`<br>`com.mediavanity.earthracer.tip.medium`<br>`com.mediavanity.earthracer.tip.large` (tips: consumable, consumed after purchase) |
| Android plugin | `android/app/src/main/java/com/mediavanity/earthracer/EarthRacerPlugin.java` (jsName `EarthRacer`, mirrors the iOS plugin) |
| Target / min SDK | 36 / 24 (Play requires target 36 since Aug 31, 2026) |
| Signing | Upload key `upload.jks` in `Development/_PlayStoreData/` (back it up); Google holds the app signing key (Play App Signing) |
| Branch | `android` (merge into main once Play testing is done) |

## Building

- Push to `android` (or Actions → "Android → Google Play" → Run workflow) builds a signed AAB on Linux.
  versionCode = run number + 100; versionName = the iOS MARKETING_VERSION.
- The AAB is the run's `app-release` artifact: `gh run download <run id> -n app-release -D <empty folder>`.
- Once the `PLAY_SERVICE_ACCOUNT_JSON` secret exists, the workflow uploads to the chosen track (default internal).
- Secrets in this repo: ANDROID_KEYSTORE_B64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD.

One-time scripts (already run; safe to re-run):

    node scripts/setup-android.mjs --plugin EarthRacerPlugin --billing
    node scripts/make-android-icons.mjs --svg icons/icon.svg --splash "<background colour>"
    node scripts/ios-to-play-metadata.mjs        # only writes files that don't exist yet
    node scripts/make-feature-graphic.mjs --svg icons/icon.svg

## What's different on Android

- Location permission for the starting point (asked by the web view)
- Back button: presses a visible Back/close button, else opens the game menu (like Escape)
- Tilt steering uses the web DeviceMotion events (no permission prompt on Android)

## Known gaps

- iOS 1.0 is still in App Review; Android is built from the same commit (build 17)

## Store listing (fastlane/metadata/android/en-US)

- title.txt, short_description.txt, full_description.txt: from the iOS listing, with iPhone and Family Sharing wording removed
  (Google Play's Family Library doesn't share in-app purchases).
- images/icon.png (512), images/featureGraphic.png (1024×500), images/phoneScreenshots/ (the iOS 6.9" shots that don't say "iPhone").

## App content answers (Play Console → Policy → App content)

- Privacy policy: the existing privacy page (its URL is in fastlane/metadata/en-US/privacy_url.txt); it names Android and Google Play since 2026-11-23.
- Ads: none. App access: everything available without an account. Data safety: no data collected or shared; purchases are handled by Google Play.
- Health apps: No health features.

## Status

- [x] Android platform, plugin port, icons, workflow; signed AAB builds on CI
- [x] Listing text, icon, feature graphic, screenshots prepared
- [ ] Play Console developer account verified (identity, trader status, device, phone)
- [ ] App created in Play Console; first AAB uploaded by hand to Internal testing
- [ ] Tested on a phone (internal track)
- [ ] Payments profile; in-app products created with the IDs above and activated; purchase tested with a license tester
- [ ] App content declarations; store listing entered
- [ ] Closed test with the shared tester group: 12+ testers opted in for 14 days (started: ____)
- [ ] Applied for production; approved; released
