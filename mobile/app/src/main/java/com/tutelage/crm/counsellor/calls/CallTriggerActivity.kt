package com.tutelage.crm.counsellor.calls

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.calls.CallDao
import com.tutelage.crm.counsellor.data.calls.CallEntity
import com.tutelage.crm.counsellor.fcm.CounsellorFirebaseMessagingService
import com.tutelage.crm.counsellor.location.AppPermissionGate
import com.tutelage.crm.counsellor.location.LocationGate
import com.tutelage.crm.counsellor.ui.theme.TutelageTheme
import com.tutelage.crm.counsellor.work.CallSyncWorker
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import timber.log.Timber
import java.util.UUID
import javax.inject.Inject

/**
 * Launched by an FCM CTC notification (full-screen intent). Shows a brief
 * privacy splash with the masked phone number, then fires ACTION_CALL.
 *
 * Note: once the system in-call UI takes over, Android shows the full number —
 * we cannot suppress that. The masking only applies to *our* UI surfaces
 * (this splash + the FCM notification body).
 */
@AndroidEntryPoint
class CallTriggerActivity : ComponentActivity() {

    @Inject lateinit var callDao: CallDao
    @Inject lateinit var tokenStore: TokenStore

    private var dialJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Defense-in-depth: re-validate the number even though the FCM service
        // already normalized it before issuing the PendingIntent.
        val phone = CounsellorFirebaseMessagingService.normalizeDialablePhone(
            intent.getStringExtra(EXTRA_PHONE)
        )
        val leadId = intent.getLongExtra(EXTRA_LEAD_ID, -1L).takeIf { it > 0 }
        val leadName = intent.getStringExtra(EXTRA_LEAD_NAME)
        val triggerCallId = intent.getLongExtra(EXTRA_TRIGGER_CALL_ID, -1L).takeIf { it > 0 }

        if (phone == null) {
            Timber.w("CallTriggerActivity: missing or invalid phone")
            finish()
            return
        }

        // This is the same enforcement MandatoryLocationHost applies inside MainActivity.
        // Without this check a push-triggered click-to-call could dial out through this
        // separate Activity even while the counsellor is fully blocked in the main app.
        val missing = AppPermissionGate.firstMissing(this, tokenStore)
        if (missing != null) {
            Timber.w("CallTriggerActivity: blocked — %s", AppPermissionGate.shortLabel(missing))
            setContent {
                TutelageTheme {
                    LocationBlockedScreen(
                        reason = AppPermissionGate.shortLabel(missing),
                        onOpenSettings = { openLocationSettings() },
                    )
                }
            }
            return
        }

        val masked = CounsellorFirebaseMessagingService.maskPhone(phone)

        setContent {
            TutelageTheme { ConnectingSplash(maskedPhone = masked, leadName = leadName) }
        }

        val deviceCallId = "ctc_${System.currentTimeMillis()}_${UUID.randomUUID()}"
        val now = System.currentTimeMillis()

        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                callDao.upsert(
                    CallEntity(
                        deviceCallId = deviceCallId,
                        leadId = leadId,
                        phoneNumber = phone,
                        direction = "OUTGOING",
                        status = "RINGING",
                        startedAt = now,
                        triggerCallId = triggerCallId,
                        source = "CRM_WEB",
                    )
                )
                CallSyncWorker.enqueue(this@CallTriggerActivity)
            }
        }

        // Brief privacy splash (~900 ms) then dial. Long enough to read the
        // masked number, short enough not to feel sluggish.
        dialJob = CoroutineScope(Dispatchers.Main).launch {
            delay(900)
            placeCall(phone)
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        dialJob?.cancel()
    }

    private fun placeCall(phone: String) {
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) ==
            PackageManager.PERMISSION_GRANTED
        val action = if (granted) Intent.ACTION_CALL else Intent.ACTION_DIAL
        startActivity(Intent(action, Uri.parse("tel:$phone")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }

    private fun openLocationSettings() {
        val target = if (!LocationGate.hasPermission(this)) LocationGate.appSettingsIntent(this)
        else Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS)
        startActivity(target.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
        finish()
    }

    companion object {
        const val EXTRA_PHONE = "phone"
        const val EXTRA_LEAD_ID = "leadId"
        const val EXTRA_LEAD_NAME = "leadName"
        const val EXTRA_TRIGGER_CALL_ID = "triggerCallId"
    }
}

@Composable
private fun LocationBlockedScreen(reason: String, onOpenSettings: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(cs.errorContainer),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Call, contentDescription = null, tint = cs.onErrorContainer, modifier = Modifier.size(46.dp))
            Spacer(Modifier.height(20.dp))
            Text(
                "Call blocked",
                color = cs.onErrorContainer,
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "$reason. Fix it in the CRM app to place calls.",
                color = cs.onErrorContainer,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
            Spacer(Modifier.height(24.dp))
            Button(onClick = onOpenSettings) { Text("Open settings") }
        }
    }
}

@Composable
private fun ConnectingSplash(maskedPhone: String, leadName: String?) {
    val cs = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(cs.primary, cs.primaryContainer))),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(shape = CircleShape, color = cs.onPrimary.copy(alpha = 0.16f)) {
                Box(modifier = Modifier.size(96.dp), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Default.Call,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(46.dp),
                    )
                }
            }
            Spacer(Modifier.height(28.dp))
            Text(
                "Connecting call",
                color = Color.White.copy(alpha = 0.85f),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                leadName ?: "Lead",
                color = Color.White,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                maskedPhone,
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Light,
            )
            Spacer(Modifier.height(36.dp))
            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp)
        }
    }
}
