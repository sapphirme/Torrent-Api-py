package com.chanime.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import org.json.JSONArray
import org.json.JSONObject

/**
 * Exposed to the page as `KVNative`. Only URLs on your own https host are accepted,
 * so a page loaded from anywhere else cannot use it to download arbitrary files.
 */
@OptIn(UnstableApi::class)
class Bridge(private val ctx: Context, private val baseHost: String) {

    private fun trusted(url: String): Boolean = runCatching {
        val u = Uri.parse(url)
        u.scheme == "https" && u.host == baseHost
    }.getOrDefault(false)

    @JavascriptInterface
    fun download(id: String, title: String, playlistUrl: String, subsUrl: String) {
        if (id.isBlank() || id.length > 100 || !trusted(playlistUrl)) return
        if (subsUrl.isNotEmpty() && !trusted(subsUrl)) return

        val meta = JSONObject().put("title", title.take(200)).put("subs", subsUrl).toString().toByteArray()
        val hls = DownloadRequest.Builder(id, Uri.parse(playlistUrl))
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .setData(meta)
            .build()
        DownloadService.sendAddDownload(ctx, OfflineDownloadService::class.java, hls, true)

        if (subsUrl.isNotEmpty()) {
            val subs = DownloadRequest.Builder("$id:subs", Uri.parse(subsUrl))
                .setMimeType(MimeTypes.TEXT_VTT)
                .build()
            DownloadService.sendAddDownload(ctx, OfflineDownloadService::class.java, subs, true)
        }
    }

    @JavascriptInterface
    fun state(): String {
        val out = JSONArray()
        Offline.manager(ctx).downloadIndex.getDownloads().use { c ->
            while (c.moveToNext()) {
                val d = c.download
                if (d.request.id.endsWith(":subs")) continue
                val meta = runCatching { JSONObject(String(d.request.data)) }.getOrDefault(JSONObject())
                out.put(
                    JSONObject()
                        .put("id", d.request.id)
                        .put("title", meta.optString("title"))
                        .put("state", stateName(d.state))
                        .put("percent", d.percentDownloaded.coerceAtLeast(0f).toDouble())
                        .put("bytes", d.bytesDownloaded)
                )
            }
        }
        return out.toString()
    }

    @JavascriptInterface
    fun remove(id: String) {
        DownloadService.sendRemoveDownload(ctx, OfflineDownloadService::class.java, id, false)
        DownloadService.sendRemoveDownload(ctx, OfflineDownloadService::class.java, "$id:subs", false)
    }

    @JavascriptInterface
    fun play(id: String) {
        ctx.startActivity(
            Intent(ctx, OfflinePlayerActivity::class.java)
                .putExtra("id", id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    private fun stateName(s: Int) = when (s) {
        Download.STATE_COMPLETED -> "done"
        Download.STATE_DOWNLOADING -> "downloading"
        Download.STATE_QUEUED -> "queued"
        Download.STATE_STOPPED -> "paused"
        Download.STATE_RESTARTING -> "restarting"
        Download.STATE_REMOVING -> "removing"
        else -> "failed"
    }
}
