# kv-cache in Kotlin (Kotlin/JS)

`src/jsMain/kotlin/KvCache.kt` is the page-side home-screen cache controller, rewritten in Kotlin.
It compiles to a plain JavaScript file with the same `window.KVCache` API as `public/kv-cache.js`:

    KVCache.init() · KVCache.on(fn) · KVCache.clear() · KVCache.install() · KVCache.refresh() · KVCache.state

and talks to the same `/sw.js` service worker. Use **one** of `kv-cache.js` / `kv-cache-kt.js`, not both.
`public/kv-cache-kt.js` is a prebuilt, minified copy (32 KB), already used by `public/index.html`.

Extra API (optional "save to device while watching"):

    const job = KVCache.prefetch('/hls/<hash>/<n>/index.m3u8', p => console.log(p));  // p = {done,total,complete,stopped,reason}
    job.stop();  // or KVCache.stopPrefetch()

It walks the HLS playlist and fetches every segment through the service worker (which stores it within its budget),
and keeps polling while the server is still processing the episode. It stops with reason `full` when the device cache refuses to store more.

Kotlin in a browser compiles to JavaScript, so it can't do anything the browser can't. Storage still goes through
the service worker, Cache API and `navigator.storage.persist()`.

## Rebuild with Gradle (recommended)
    cd kotlin-js
    gradle wrapper          # once, or open the folder in IntelliJ / Android Studio
    ./gradlew jsBrowserDistribution
    # output: build/dist/js/productionExecutable/kv-cache-kt.js  -> copy to public/

## Rebuild with the bare compiler (what I used to verify it)
    S=kotlinc/lib/kotlin-stdlib-js.klib
    kotlinc-js -libraries $S -Xir-produce-klib-file -ir-output-dir klib -ir-output-name kvcache -Xir-module-name=kvcache src/jsMain/kotlin/KvCache.kt
    kotlinc-js -libraries $S -Xir-produce-js -Xinclude=klib/kvcache.klib -ir-output-dir out -ir-output-name kvcache -Xir-module-name=kvcache -main call -Xir-dce -Xir-minimized-member-names
    npx esbuild out/kvcache.js --minify --outfile=public/kv-cache-kt.js

Verified with Kotlin 2.2.0 (compiled, then tested in Node with a fake service worker: tab/installed modes, finished and still-processing episodes, cache-full stop, stop()). The Gradle files were not run here.
