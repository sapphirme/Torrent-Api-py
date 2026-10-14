package kvcache

import kotlin.js.Promise

/*
 * Kotlin/JS version of kv-cache.js. Same public API on window.KVCache:
 *   KVCache.init({ swUrl }) · KVCache.on(fn) · KVCache.clear() · KVCache.install() · KVCache.refresh() · KVCache.state
 * It talks to the same /sw.js service worker. Elements with [data-kv-install] become install buttons.
 */

// plain dynamic access to the browser globals, so no DOM library dependency is needed
private val window: dynamic = js("window")
private val document: dynamic = js("document")
private val nav: dynamic = js("navigator")

private val isIOS: Boolean =
    Regex("iphone|ipad|ipod", RegexOption.IGNORE_CASE).containsMatchIn(nav.userAgent as String) ||
        (nav.platform == "MacIntel" && ((nav.maxTouchPoints ?: 0) as Int) > 1)

private class State {
    val supported: Boolean = js("'serviceWorker' in navigator") as Boolean
    var installed = false
    var persisted = false
    var canInstall = false
    var bytes = 0.0
    var episodes = 0
    var budget = 0.0

    fun snapshot(): dynamic {
        val o: dynamic = js("({})")
        o.supported = supported; o.installed = installed; o.persisted = persisted
        o.canInstall = canInstall; o.ios = isIOS
        o.bytes = bytes; o.episodes = episodes; o.budget = budget
        return o
    }
}

private val st = State()
private val listeners = mutableListOf<dynamic>()
private var deferred: dynamic = null

private fun obj(vararg pairs: Pair<String, dynamic>): dynamic {
    val o: dynamic = js("({})")
    for ((k, v) in pairs) o[k] = v
    return o
}

private fun standalone(): Boolean =
    window.matchMedia("(display-mode: standalone)").matches || nav.standalone == true

private fun wireButtons() {
    val els: dynamic = document.querySelectorAll("[data-kv-install]")
    for (i in 0 until (els.length as Int)) {
        val e = els[i]
        e.hidden = st.installed || !(st.canInstall || isIOS)
        e.onclick = { _: dynamic -> install() }
    }
}

private fun emit() {
    wireButtons()
    val snap = st.snapshot()
    for (l in listeners) {
        try { l(snap) } catch (e: Throwable) { console.warn("KVCache listener failed", e) }
    }
}

private fun ask(msg: dynamic): dynamic = Promise<dynamic> { resolve, _ ->
    val sw: dynamic = nav.serviceWorker.controller
    if (sw == null) {
        resolve(null)
    } else {
        val ch: dynamic = js("new MessageChannel()")
        ch.port1.onmessage = { e: dynamic -> resolve(e.data) }
        sw.postMessage(msg, arrayOf(ch.port2))
        window.setTimeout({ resolve(null) }, 3000)
    }
}

private fun refreshUsage(): dynamic = ask(obj("type" to "usage")).then { u: dynamic ->
    if (u != null) {
        st.bytes = u.bytes
        st.episodes = u.episodes
        st.budget = u.budget
    }
    emit()
}

private fun sync(): dynamic {
    st.installed = standalone()
    val storage: dynamic = nav.storage
    val canQuery = storage != undefined && jsTypeOf(storage.persisted) == "function"
    val canPersist = storage != undefined && jsTypeOf(storage.persist) == "function"
    val first: dynamic = if (canQuery) storage.persisted() else Promise.resolve(false)
    return first.then { already: dynamic ->
        // only ask the browser to protect the storage once the app is installed
        if (already != true && st.installed && canPersist) storage.persist() else already
    }.catch { _: dynamic -> false }.then { p: dynamic ->
        var persisted = p == true
        // iOS home-screen apps are exempt from Safari's 7-day script-storage cleanup
        if (st.installed && isIOS && !canPersist) persisted = true
        st.persisted = persisted
        ask(obj("type" to "mode", "installed" to st.installed, "persisted" to persisted))
    }.then { refreshUsage() }
}

private fun install() {
    val d = deferred
    if (d != null) {
        d.prompt()
        d.userChoice.then { deferred = null; st.canInstall = false; emit() }
    } else if (isIOS) {
        window.alert("To install: tap the Share button, then \"Add to Home Screen\".")
    }
}

private fun init(opts: dynamic): dynamic {
    if (!st.supported) { emit(); return Promise.resolve(null) }
    val swUrl: String = if (opts != undefined && opts != null && opts.swUrl != undefined) opts.swUrl as String else "/sw.js"

    window.addEventListener("beforeinstallprompt", { e: dynamic ->
        e.preventDefault(); deferred = e; st.canInstall = true; emit()
    })
    window.addEventListener("appinstalled", { _: dynamic -> sync() })
    window.matchMedia("(display-mode: standalone)").addEventListener("change", { _: dynamic -> sync() })
    document.addEventListener("visibilitychange", { _: dynamic -> if (!document.hidden) refreshUsage() })

    val sw: dynamic = nav.serviceWorker
    return sw.register(swUrl, obj("scope" to "/")).then { sw.ready }.then {
        if (sw.controller == null) {
            Promise<dynamic> { done, _ ->
                sw.addEventListener("controllerchange", { _: dynamic -> done(null) }, obj("once" to true))
                window.setTimeout({ done(null) }, 1500)
            }
        } else null
    }.then { sync() }
}


/* ---------- optional "save to device while watching" ---------- */

private val fetchFn: dynamic = js("fetch")
private val resolveUrl: dynamic = js("(function(u, b) { return new URL(u, b).href; })")
private val sleepFn: dynamic = js("(function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); })")
private val cachesMatch: dynamic = js("(function(u) { return caches.match(u); })")

private class Job(val url: String) {
    var stopped = false
    var done = 0
    var total = 0
    var complete = false
    var reason: String? = null
}

private class Loop {
    val seen = HashSet<String>()
    var failures = 0
    var notStored = 0
    var fetchedAny = false
}

private var activeJob: Job? = null

private fun progress(job: Job, cb: dynamic) {
    if (cb == undefined || cb == null) return
    try {
        cb(obj("done" to job.done, "total" to job.total, "complete" to job.complete,
            "stopped" to job.stopped, "reason" to job.reason))
    } catch (e: Throwable) { console.warn("KVCache progress callback failed", e) }
}

// Fetch each segment through the service worker, which stores it (within its budget).
// Written as plain promise chains. One segment at a time, in playlist order.
private fun fetchSegments(job: Job, cb: dynamic, lp: Loop, segs: List<String>, i: Int): dynamic {
    if (i >= segs.size || job.stopped) return Promise.resolve(null)
    val u = resolveUrl(segs[i], job.url) as String
    if (u in lp.seen) return fetchSegments(job, cb, lp, segs, i + 1)
    return cachesMatch(u).then { hit: dynamic ->
        if (hit != null) {
            lp.seen.add(u); job.done = lp.seen.size
            fetchSegments(job, cb, lp, segs, i + 1)
        } else {
            fetchFn(u).then({ r: dynamic ->
                if (r.ok == true) {
                    // drain the body; the service worker keeps its own copy, then check it was stored
                    r.blob().then { sleepFn(120) }.then { cachesMatch(u) }.then { stored: dynamic ->
                        lp.fetchedAny = true
                        if (stored == null) {
                            lp.notStored++
                            if (lp.notStored >= 2) { job.reason = "full"; job.stopped = true }
                        } else { lp.notStored = 0; lp.seen.add(u) }
                        job.done = lp.seen.size
                        progress(job, cb)
                        fetchSegments(job, cb, lp, segs, i + 1)
                    }
                } else {
                    lp.failures++
                    if (lp.failures > 5) { job.reason = "network"; job.stopped = true }
                    fetchSegments(job, cb, lp, segs, i + 1)
                }
            }, { _: dynamic ->
                lp.failures++
                if (lp.failures > 5) { job.reason = "network"; job.stopped = true }
                fetchSegments(job, cb, lp, segs, i + 1)
            })
        }
    }
}

// One pass over the playlist; if the server is still processing the episode, wait and go again.
private fun pass(job: Job, cb: dynamic, lp: Loop): dynamic {
    if (job.stopped) return Promise.resolve(null)
    lp.fetchedAny = false
    return fetchFn(job.url, obj("cache" to "no-store")).then { pl: dynamic ->
        if (pl.ok != true) {
            job.reason = "playlist-" + pl.status
            Promise.resolve(null)
        } else {
            pl.text().then { t: dynamic ->
                val text = t as String
                val segs = text.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
                val ended = text.contains("#EXT-X-ENDLIST")
                job.total = segs.size
                fetchSegments(job, cb, lp, segs, 0).then {
                    job.done = lp.seen.size
                    if (job.stopped) Promise.resolve(null)
                    else if (ended && lp.seen.size >= segs.size) { job.complete = true; Promise.resolve(null) }
                    else if (ended && lp.fetchedAny) pass(job, cb, lp)                  // retry what's missing
                    else if (ended) { job.reason = "incomplete"; Promise.resolve(null) }
                    else sleepFn(3000).then { pass(job, cb, lp) }                        // still processing
                }
            }
        }
    }
}

private fun prefetch(playlistUrl: String, cb: dynamic): dynamic {
    activeJob?.stopped = true
    val job = Job(playlistUrl)
    activeJob = job
    if (nav.serviceWorker == undefined || nav.serviceWorker.controller == null) {
        job.reason = "no-service-worker"; progress(job, cb)
    } else {
        val finish = { refreshUsage(); progress(job, cb); Unit }
        pass(job, cb, Loop()).then({ _: dynamic -> finish() }, { e: dynamic ->
            console.warn("KVCache prefetch failed", e); job.reason = "error"; finish()
        })
    }
    val handle: dynamic = js("({})")
    handle.stop = { job.stopped = true; Unit }
    return handle
}

fun main() {
    val api: dynamic = js("({})")
    api.init = { opts: dynamic -> init(opts) }
    api.on = { f: dynamic -> listeners.add(f); f(st.snapshot()) }
    api.clear = { ask(obj("type" to "clear")).then { refreshUsage() } }
    api.install = { install() }
    api.refresh = { refreshUsage() }
    api.prefetch = { url: dynamic, cb: dynamic -> prefetch(url as String, cb) }
    api.stopPrefetch = { activeJob?.stopped = true; Unit }
    val defineProp: dynamic = js("Object.defineProperty")
    defineProp(api, "state", obj("get" to { st.snapshot() }))
    window.KVCache = api
    wireButtons()
}
