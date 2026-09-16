package com.tutelage.crm.counsellor.work

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.tutelage.crm.counsellor.data.calls.CallRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import timber.log.Timber
import java.util.concurrent.TimeUnit

@HiltWorker
class RecordingUploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val repo: CallRepository,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = try {
        // Ask to run in the foreground. Call recordings are multi-megabyte
        // audio files; a plain background worker is the first thing aggressive
        // OEMs (Xiaomi/Vivo/Oppo — the ones this app targets) reclaim, which
        // aborted uploads mid-transfer over and over.
        runCatching { setForeground(getForegroundInfo()) }
        val n = repo.uploadPendingRecordings()
        Timber.d("RecordingUploadWorker uploaded %d files", n)
        Result.success()
    } catch (t: Throwable) {
        Timber.w(t, "RecordingUploadWorker failed; will retry")
        if (runAttemptCount >= MAX_ATTEMPTS) Result.failure() else Result.retry()
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        val context = applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Recording upload",
                    // MIN: this is housekeeping the counsellor never has to act
                    // on. It exists to keep the process alive, not to interrupt.
                    NotificationManager.IMPORTANCE_MIN,
                ).apply { setShowBadge(false) },
            )
        }
        val notification: Notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Uploading call recordings")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val UNIQUE_NAME = "recording-upload"
        private const val PERIODIC_NAME = "recording-upload-periodic"
        private const val CHANNEL_ID = "recording_upload"
        private const val NOTIFICATION_ID = 4711
        private const val MAX_ATTEMPTS = 10

        fun enqueue(context: Context) {
            val req = OneTimeWorkRequestBuilder<RecordingUploadWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
                // Expedited when quota allows, ordinary background work when it
                // doesn't — either way it is not silently dropped.
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context)
                // KEEP, not APPEND_OR_REPLACE: five call-end events in a row used
                // to chain five identical uploader runs behind each other, and
                // each one re-reads the same pending queue anyway.
                .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.KEEP, req)
        }

        fun enqueuePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<RecordingUploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
