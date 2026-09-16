package com.tutelage.crm.counsellor.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.work.CallSyncWorker
import com.tutelage.crm.counsellor.work.RecordingUploadWorker
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Without this, a device reboot silently and permanently stops tracking until
 * the counsellor happens to reopen the app — nothing else brings the
 * foreground service back.
 *
 * MY_PACKAGE_REPLACED matters just as much: an app update cancels the process
 * and, on many OEMs, leaves the app in the stopped state until it is launched.
 * Call sync and recording uploads were dead in that window, so a counsellor who
 * updated and then made calls without reopening the app shipped nothing.
 */
@AndroidEntryPoint
class LocationBootReceiver : BroadcastReceiver() {
    @Inject lateinit var tokenStore: TokenStore

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (tokenStore.token.isNullOrBlank()) return

        // Call sync and recording upload are not location-gated — a counsellor
        // with tracking disabled still needs their calls to reach the CRM.
        CallSyncWorker.enqueue(context)
        CallSyncWorker.enqueuePeriodic(context)
        RecordingUploadWorker.enqueue(context)

        if (!tokenStore.locationTrackingEnabled) return
        if (LocationTrackingService.hasLocationPermission(context)) LocationTrackingService.start(context)
        LocationSyncWorker.enqueue(context)
    }
}
