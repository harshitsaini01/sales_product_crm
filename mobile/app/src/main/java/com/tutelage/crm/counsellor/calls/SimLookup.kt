package com.tutelage.crm.counsellor.calls

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import timber.log.Timber

/**
 * Resolves CallLog `PHONE_ACCOUNT_ID` (the iccId/sub-id of the SIM that handled
 * the call) into something user-friendly: SIM slot, carrier name, and the MSISDN
 * if the carrier exposes it. Most Indian carriers don't populate the MSISDN, so
 * `simNumber` is frequently null — slot + carrier are the reliable fields.
 */
data class SimInfo(
    val slot: Int?,
    val carrier: String?,
    val number: String?,
)

object SimLookup {

    fun resolve(context: Context, phoneAccountId: String?): SimInfo {
        if (phoneAccountId.isNullOrBlank()) return SimInfo(null, null, null)
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return SimInfo(null, null, null)
        }
        val sm = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE)
            as? SubscriptionManager ?: return SimInfo(null, null, null)

        @SuppressLint("MissingPermission")
        val active: List<SubscriptionInfo> = try {
            sm.activeSubscriptionInfoList ?: emptyList()
        } catch (t: Throwable) {
            Timber.w(t, "Failed to list active subscriptions")
            return SimInfo(null, null, null)
        }
        if (active.isEmpty()) return SimInfo(null, null, null)

        // PHONE_ACCOUNT_ID is the iccId on most OEMs but a few stash the subscriptionId
        // there. Try both.
        val match = active.firstOrNull { sub ->
            sub.iccId == phoneAccountId || sub.subscriptionId.toString() == phoneAccountId
        } ?: return SimInfo(null, null, null)

        val slot = match.simSlotIndex.takeIf { it >= 0 }?.let { it + 1 } // 1-based for humans
        val carrier = match.carrierName?.toString()?.takeIf { it.isNotBlank() }
        @SuppressLint("MissingPermission")
        val number = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // SDK 33+ requires a per-subscription getter that returns "" when blocked.
            try {
                sm.getPhoneNumber(match.subscriptionId).takeIf { !it.isNullOrBlank() }
            } catch (_: Throwable) { null }
        } else {
            @Suppress("DEPRECATION")
            match.number?.takeIf { it.isNotBlank() }
        }

        return SimInfo(slot = slot, carrier = carrier, number = number)
    }
}
