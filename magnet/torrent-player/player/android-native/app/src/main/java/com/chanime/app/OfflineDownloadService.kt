package com.chanime.app

import android.app.Notification
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Scheduler

@OptIn(UnstableApi::class)
class OfflineDownloadService : DownloadService(
    FOREGROUND_ID,
    DownloadService.DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,
    Offline.CHANNEL_ID,
    R.string.offline_channel,
    0
) {
    override fun getDownloadManager(): DownloadManager = Offline.manager(this)

    // No background scheduler: interrupted downloads resume the next time the app is opened.
    override fun getScheduler(): Scheduler? = null

    override fun getForegroundNotification(
        downloads: MutableList<Download>, notMetRequirements: Int
    ): Notification = Offline.notifications(this).buildProgressNotification(
        this, android.R.drawable.stat_sys_download, null, null, downloads, notMetRequirements
    )

    companion object { private const val FOREGROUND_ID = 7 }
}
