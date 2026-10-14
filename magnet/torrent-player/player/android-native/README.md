# Chanime Android shell (offline downloads)

A thin WebView app around the site. The website stays the website; Kotlin only does:
- **Save offline**: downloads an episode's HLS playlist + segments (+ subtitles) that *your server already produced* into the app's private storage on the phone (not the VPS).
- **Offline player**: plays them from that storage with no connection.

It only accepts https URLs on your own host, and has no IRC/torrent code.

## Build
1. Android Studio -> New Project -> "Empty Views Activity", package `com.chanime.app`, language Kotlin, minSdk 24.
2. Copy `app/src/main/AndroidManifest.xml`, `res/values/strings.xml` and the five `.kt` files over the generated ones (keep the generated launcher icons).
3. In `app/build.gradle.kts` add:
   ```kotlin
   dependencies {
       val media3 = "1.8.0"   // or the latest 1.x
       implementation("androidx.media3:media3-exoplayer:$media3")
       implementation("androidx.media3:media3-exoplayer-hls:$media3")
       implementation("androidx.media3:media3-ui:$media3")
       implementation("androidx.media3:media3-database:$media3")
       implementation("androidx.media3:media3-datasource:$media3")
   }
   ```
4. Set `BASE_URL` in `MainActivity.kt` to your site (must be https).
5. Web side (already in the web-torrent-player zip): `public/native-bridge.js` + the "Save offline" button and "Saved offline" list in `public/index.html`. Copy the same idea into Chanime's templates.
6. Run on a phone or emulator.

## Notes / limits
- Only download episodes that are **complete on the server** (the button only appears for cached files), because an in-progress playlist would give a partial copy.
- Interrupted downloads resume the next time the app opens (no background scheduler).
- Subtitles are the converted WebVTT track (ASS styling is not kept).
- Downloads are never auto-evicted; the user deletes them in the list.
- iOS would need a separate Swift app. On iPhone, the PWA device cache is the offline option.
