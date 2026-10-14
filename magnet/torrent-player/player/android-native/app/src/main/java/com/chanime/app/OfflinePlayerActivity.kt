package com.chanime.app

import android.app.Activity
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import org.json.JSONObject

/** Plays a downloaded episode straight from the on-device cache. Works with no connection. */
@OptIn(UnstableApi::class)
class OfflinePlayerActivity : Activity() {
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra("id") ?: return finish()
        val download = Offline.manager(this).downloadIndex.getDownload(id) ?: return finish()

        val subsUrl = runCatching { JSONObject(String(download.request.data)).optString("subs") }.getOrDefault("")
        val item = MediaItem.Builder()
            .setUri(download.request.uri)
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .apply {
                if (subsUrl.isNotEmpty()) {
                    setSubtitleConfigurations(
                        listOf(
                            MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(subsUrl))
                                .setMimeType(MimeTypes.TEXT_VTT)
                                .setLanguage("en")
                                .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                                .build()
                        )
                    )
                }
            }
            .build()

        val exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(Offline.playbackFactory(this)))
            .build()
        player = exo
        setContentView(PlayerView(this).also { it.player = exo })
        exo.setMediaItem(item)
        exo.prepare()
        exo.playWhenReady = true
    }

    override fun onStop() { super.onStop(); player?.pause() }
    override fun onDestroy() { player?.release(); player = null; super.onDestroy() }
}
