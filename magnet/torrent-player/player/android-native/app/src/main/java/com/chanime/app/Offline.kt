package com.chanime.app

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import java.io.File
import java.util.concurrent.Executors

/** Shared download cache + manager. Files live in the app's private storage on the phone. */
@OptIn(UnstableApi::class)
object Offline {
    const val CHANNEL_ID = "offline_downloads"

    private var db: StandaloneDatabaseProvider? = null
    private var cache: SimpleCache? = null
    private var manager: DownloadManager? = null
    private var notifications: DownloadNotificationHelper? = null

    private fun http() = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)

    @Synchronized
    fun database(ctx: Context): StandaloneDatabaseProvider =
        db ?: StandaloneDatabaseProvider(ctx.applicationContext).also { db = it }

    // NoOpCacheEvictor: downloaded episodes are never auto-deleted; the user removes them.
    @Synchronized
    fun cache(ctx: Context): SimpleCache =
        cache ?: SimpleCache(File(ctx.applicationContext.filesDir, "offline"), NoOpCacheEvictor(), database(ctx))
            .also { cache = it }

    @Synchronized
    fun manager(ctx: Context): DownloadManager =
        manager ?: DownloadManager(
            ctx.applicationContext, database(ctx), cache(ctx), http(), Executors.newFixedThreadPool(2)
        ).also { it.maxParallelDownloads = 2; manager = it }

    @Synchronized
    fun notifications(ctx: Context): DownloadNotificationHelper =
        notifications ?: DownloadNotificationHelper(ctx.applicationContext, CHANNEL_ID).also { notifications = it }

    /** Reads from the download cache first; never writes to it during playback. */
    fun playbackFactory(ctx: Context): CacheDataSource.Factory =
        CacheDataSource.Factory()
            .setCache(cache(ctx))
            .setUpstreamDataSourceFactory(http())
            .setCacheWriteDataSinkFactory(null)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
}
