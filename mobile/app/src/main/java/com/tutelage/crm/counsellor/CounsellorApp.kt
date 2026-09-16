package com.tutelage.crm.counsellor

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.hilt.work.HiltWorkerFactory
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Configuration
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.util.AppForeground
import com.tutelage.crm.counsellor.util.CrashlyticsTree
import com.tutelage.crm.counsellor.location.LocationSyncWorker
import com.tutelage.crm.counsellor.work.CallSyncWorker
import com.tutelage.crm.counsellor.work.RecordingUploadWorker
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltAndroidApp
class CounsellorApp : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory

    /** Only used to answer "is anyone signed in?" before kicking sync work. */
    @Inject lateinit var tokenStore: TokenStore

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var foregroundSyncJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        plantLogging()
        createDefaultChannel()
        // Keep call rows + recordings flowing to the server even if the user
        // never opens the app: 15-min periodic workers + an immediate one-shot.
        CallSyncWorker.enqueuePeriodic(this)
        RecordingUploadWorker.enqueuePeriodic(this)
        CallSyncWorker.enqueue(this)
        RecordingUploadWorker.enqueue(this)
        // Watchdog: refreshes location-tracking flags from the server and restarts
        // LocationTrackingService if the OS/OEM killed it while backgrounded.
        LocationSyncWorker.enqueuePeriodic(this)

        // While the app is in the foreground a slow loop tops up the 15-min
        // periodic worker so freshly-placed calls (and the OEM recordings that
        // follow) reach the CRM without tapping Sync. The loop pauses when the
        // app backgrounds — WorkManager + PhoneStateReceiver take over.
        //
        // It used to fire every 30s while five other call sites also enqueued,
        // all with APPEND_OR_REPLACE, so a sync taking longer than the interval
        // built a growing chain of identical runs that fired back to back. The
        // interval is now 3 minutes and both workers enqueue with KEEP, so a
        // run already queued or in flight simply absorbs the request. Real
        // urgency is covered by PhoneStateReceiver enqueueing on every call end.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                AppForeground.set(true)
                if (!tokenStore.token.isNullOrBlank()) {
                    CallSyncWorker.enqueue(this@CounsellorApp)
                    RecordingUploadWorker.enqueue(this@CounsellorApp)
                }
                startForegroundSyncLoop()
            }

            override fun onStop(owner: LifecycleOwner) {
                // Parks every screen's poll loop — see AppForeground.
                AppForeground.set(false)
                foregroundSyncJob?.cancel()
                foregroundSyncJob = null
            }
        })
    }

    private fun startForegroundSyncLoop() {
        if (foregroundSyncJob?.isActive == true) return
        foregroundSyncJob = appScope.launch {
            while (isActive) {
                delay(FOREGROUND_SYNC_INTERVAL_MS)
                // The loop is tied to the process lifecycle, not the session, so
                // after a logout it happily kept enqueueing workers that could
                // only ever 401. Nothing to sync without a signed-in user.
                if (tokenStore.token.isNullOrBlank()) continue
                CallSyncWorker.enqueue(this@CounsellorApp)
                RecordingUploadWorker.enqueue(this@CounsellorApp)
            }
        }
    }

    private companion object {
        const val FOREGROUND_SYNC_INTERVAL_MS = 3 * 60_000L
    }

    /**
     * Timber was never planted, so every Timber call in the app was a no-op —
     * in debug as well as release. Nothing was being logged anywhere.
     *
     * A signed-in counsellor is tagged on Crashlytics by internal user id (not
     * name, email or number) so a crash from the field can be traced back to a
     * person to talk to, without putting PII in the report.
     */
    private fun plantLogging() {
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        } else {
            Timber.plant(CrashlyticsTree())
        }
        val userId = tokenStore.userId
        if (userId != 0L) {
            runCatching { FirebaseCrashlytics.getInstance().setUserId(userId.toString()) }
        }
    }

    private fun createDefaultChannel() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val id = getString(R.string.default_notification_channel)
        if (nm.getNotificationChannel(id) == null) {
            nm.createNotificationChannel(
                // This channel carries click-to-call, which uses a full-screen
                // intent — it has to behave like an incoming call, not like a
                // silent info notification. IMPORTANCE_HIGH alone left it with
                // the default sound/vibration profile, which some OEMs
                // downgrade; the explicit call-style attributes and a vibration
                // pattern make it consistently noticeable.
                NotificationChannel(id, "Calls & alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Click-to-call requests and urgent CRM alerts"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 400, 200, 400)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    setBypassDnd(true)
                    setShowBadge(true)
                }
            )
        }
    }
}
