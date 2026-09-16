package com.tutelage.crm.counsellor.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.tutelage.crm.counsellor.calls.CallLogBackfiller
import com.tutelage.crm.counsellor.data.calls.CallRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import timber.log.Timber
import java.util.concurrent.TimeUnit

@HiltWorker
class CallSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val repo: CallRepository,
    private val backfiller: CallLogBackfiller,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        // Give-up ceiling. Every step used to funnel into Result.retry(), so a
        // permanently-failing pass (a row the server always rejects, a revoked
        // token) kept the whole pipeline in retry state indefinitely with no
        // visibility. The periodic worker still runs every 15 minutes, so
        // giving up on this chain loses nothing but the pointless backoff.
        if (runAttemptCount >= MAX_ATTEMPTS) {
            Timber.w("CallSyncWorker giving up after %d attempts; periodic pass will retry", runAttemptCount)
            return Result.failure()
        }
        // Each step is wrapped so a failure in one (e.g. transient network) still
        // lets the others make progress, and the overall worker reports retry so
        // WorkManager re-runs the entire pipeline with exponential backoff. The
        // user's guarantee: if recording, status, or call-log seeding fails, the
        // next pass picks up exactly the unfinished part.
        var anyFailed = false

        runCatching {
            val backfilled = backfiller.backfill(applicationContext)
            if (backfilled > 0) Timber.d("CallSyncWorker backfilled %d call-log row(s)", backfilled)
        }.onFailure {
            Timber.w(it, "CallSyncWorker: backfill failed; will retry")
            anyFailed = true
        }

        // Close out stale RINGING rows and attach late-arriving recordings BEFORE
        // syncPending so the corrected state ships in the same push.
        runCatching { repo.reconcile() }
            .onFailure {
                Timber.w(it, "CallSyncWorker: reconcile failed; will retry")
                anyFailed = true
            }

        runCatching {
            val n = repo.syncPending()
            Timber.d("CallSyncWorker synced %d calls", n)
        }.onFailure {
            Timber.w(it, "CallSyncWorker: syncPending failed; will retry")
            anyFailed = true
        }

        // Always kick the upload worker — there may be unfinished uploads from
        // a prior pass even when nothing else changed.
        RecordingUploadWorker.enqueue(applicationContext)

        return if (anyFailed) Result.retry() else Result.success()
    }

    companion object {
        private const val MAX_ATTEMPTS = 8

        private const val UNIQUE_NAME = "call-sync"
        private const val PERIODIC_NAME = "call-sync-periodic"

        fun enqueue(context: Context) {
            val req = OneTimeWorkRequestBuilder<CallSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                // KEEP, not APPEND_OR_REPLACE. Six call sites enqueue this
                // (app foreground loop, PhoneStateReceiver, CallTriggerActivity,
                // two ViewModels, and doWork itself) — appending built a chain
                // of identical back-to-back runs, each doing a full network
                // round-trip plus a call-log and OEM-folder rescan.
                .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.KEEP, req)
        }

        fun enqueuePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<CallSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
