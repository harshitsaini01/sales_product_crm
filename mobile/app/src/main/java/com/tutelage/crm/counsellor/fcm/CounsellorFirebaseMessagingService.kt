package com.tutelage.crm.counsellor.fcm

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tutelage.crm.counsellor.R
import com.tutelage.crm.counsellor.calls.CallTriggerActivity
import com.tutelage.crm.counsellor.data.auth.AuthRepository
import com.tutelage.crm.counsellor.util.PhoneVisibility
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@AndroidEntryPoint
class CounsellorFirebaseMessagingService : FirebaseMessagingService() {

    @Inject lateinit var authRepository: AuthRepository

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onNewToken(token: String) {
        scope.launch {
            runCatching { authRepository.registerFcmToken(token) }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "CTC" -> handleClickToCall(data)
            else -> Timber.d("Ignoring FCM data type=%s", data["type"])
        }
    }

    private fun handleClickToCall(data: Map<String, String>) {
        val phone = normalizeDialablePhone(data["phone"]) ?: run {
            Timber.w("CTC rejected: missing or unsafe phone payload"); return
        }
        val leadId = data["leadId"]?.toLongOrNull() ?: -1L
        val leadName = data["leadName"]
        val triggerCallId = data["callId"]?.toLongOrNull() ?: -1L

        val triggerIntent = Intent(this, CallTriggerActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(CallTriggerActivity.EXTRA_PHONE, phone)
            if (leadId > 0) putExtra(CallTriggerActivity.EXTRA_LEAD_ID, leadId)
            if (!leadName.isNullOrBlank()) putExtra(CallTriggerActivity.EXTRA_LEAD_NAME, leadName)
            if (triggerCallId > 0) putExtra(CallTriggerActivity.EXTRA_TRIGGER_CALL_ID, triggerCallId)
        }
        val pi = PendingIntent.getActivity(
            this,
            triggerCallId.toInt().takeIf { it != 0 } ?: phone.hashCode(),
            triggerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val channelId = getString(R.string.default_notification_channel)
        // Privacy: never show the full phone number in the UI — only the last 5 digits.
        val maskedPhone = maskPhone(phone)
        val title = "Calling ${leadName ?: maskedPhone}"
        val body = "Tap to dial — CRM is requesting a call to $maskedPhone"
        val notif = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.sym_call_outgoing)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(false)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notifId = (triggerCallId.takeIf { it > 0 } ?: System.currentTimeMillis()).toInt()
        nm.notify(notifId, notif)
    }

    companion object {
        /**
         * Returns a clean, dialable phone number (digits, optional single leading
         * '+') or null if the payload value is missing/unsafe. FCM data payloads
         * are not trusted: this blocks USSD/MMI codes ('*' '#'), embedded
         * separators, and anything outside E.164 length bounds so a forged or
         * leaked-key CTC push cannot drive the dialer to an arbitrary number or a
         * special service code.
         */
        fun normalizeDialablePhone(raw: String?): String? {
            if (raw.isNullOrBlank()) return null
            if (raw.any { it == '*' || it == '#' }) return null // USSD/MMI
            val hasPlus = raw.trim().startsWith("+")
            val digits = raw.filter { it.isDigit() }
            if (digits.length < 7 || digits.length > 15) return null
            return if (hasPlus) "+$digits" else digits
        }

        /**
         * Delegates to the app-wide [com.tutelage.crm.counsellor.util.maskPhone].
         *
         * This used to be a SECOND, opposite masking scheme: it hid everything
         * except the last 5 digits ("•••••43210") while the util one hides the
         * last 5 and shows the prefix ("9198765 •••••"). Each looked like a
         * reasonable mask alone, but a counsellor who saw the same lead in the
         * list AND in a click-to-call notification could read the two halves off
         * against each other and reconstruct the whole number — which is exactly
         * what the masking exists to prevent. One scheme, one definition.
         */
        fun maskPhone(phone: String): String =
            com.tutelage.crm.counsellor.util.maskPhone(phone)
    }
}
