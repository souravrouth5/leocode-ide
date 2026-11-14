package dev.leocode

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Keeps the app process (and therefore its PTYs and `proc.run` jobs) alive while
 * the WebView is gone (Task 10).
 *
 * The notification reports how many terminals/jobs are running and offers
 * **Stop all**. The channel is created on the first session, not at app start, so
 * a user who never opens a terminal never sees a notification channel.
 */
class SessionService : Service() {

    companion object {
        private const val CHANNEL_ID = "leocode.sessions"
        private const val NOTIFICATION_ID = 0x5e55
        private const val ACTION_UPDATE = "dev.leocode.SESSION_UPDATE"
        private const val ACTION_STOP_ALL = "dev.leocode.SESSION_STOP_ALL"
        private const val EXTRA_COUNT = "count"

        /**
         * Start or update the foreground service with the current session count.
         * `count == 0` asks the service to stop itself on the main thread; callers
         * must not use [stop] for that, because stopping a service while its first
         * foreground start is still pending throws `ForegroundServiceDidNotStartInTime`.
         */
        fun update(context: Context, count: Int) {
            val intent = Intent(context, SessionService::class.java)
                .setAction(ACTION_UPDATE)
                .putExtra(EXTRA_COUNT, count)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }

        /** Hard stop, for teardown paths where no session is left to update. */
        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, SessionService::class.java)) }
        }
    }

    /** True once `startForeground` succeeded for this service instance. */
    private var foregrounded = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_ALL -> {
                satisfyForegroundStart()
                // Terminating jobs waits up to 2 s per process; keep that off the
                // main thread. closeBridge() also stops this service.
                Thread(
                    {
                        runCatching { (application as? LeoApp)?.graph?.closeBridge() }
                        stopSelf()
                    },
                    "leocode-stop-all"
                ).apply { isDaemon = true }.start()
            }
            ACTION_UPDATE -> {
                val count = intent.getIntExtra(EXTRA_COUNT, 0)
                if (count <= 0) {
                    // A startForegroundService request must be answered even when the
                    // session has already exited, so start once before stopping.
                    satisfyForegroundStart()
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    foregrounded = false
                    stopSelf()
                } else {
                    ensureChannel()
                    startForeground(NOTIFICATION_ID, buildNotification(count))
                    foregrounded = true
                }
            }
            else -> {
                satisfyForegroundStart()
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    /** Answer a pending foreground-service start if this instance has not yet. */
    private fun satisfyForegroundStart() {
        if (foregrounded) return
        ensureChannel()
        startForeground(NOTIFICATION_ID, buildNotification(0))
        foregrounded = true
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        super.onDestroy()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Running processes",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows how many terminal sessions and jobs LeoCode keeps alive"
                setShowBadge(false)
            }
        )
    }

    private fun buildNotification(count: Int): Notification {
        val stopAll = PendingIntent.getService(
            this,
            1,
            Intent(this, SessionService::class.java).setAction(ACTION_STOP_ALL),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val open = PendingIntent.getActivity(
            this,
            2,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_session)
            .setContentTitle(
                "$count ${if (count == 1) "process" else "processes"} running"
            )
            .setContentText("Terminals and jobs keep running in the background")
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        @Suppress("DEPRECATION")
        builder.addAction(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Stop all",
            stopAll
        )
        return builder.build()
    }
}
