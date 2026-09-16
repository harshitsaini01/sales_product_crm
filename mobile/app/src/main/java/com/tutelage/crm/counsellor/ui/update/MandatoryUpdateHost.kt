package com.tutelage.crm.counsellor.ui.update

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * App-wide blocking gate — mounted once on MainScreen alongside InactivityHost.
 * When the latest release is marked mandatory and the installed build is
 * older, this covers the whole app with a non-dismissible dialog: no back
 * press, no tap-outside, no skip button. The only way through is "Update now".
 *
 * Non-mandatory updates are NOT handled here — those keep the existing
 * dismissible banner on the Leads list.
 */
@Composable
fun MandatoryUpdateHost(vm: MandatoryUpdateViewModel = hiltViewModel()) {
    val update by vm.updateAvailable.collectAsState()
    val installError by vm.installError.collectAsState()
    val downloading by vm.downloading.collectAsState()

    val ua = update
    if (ua == null || !ua.isMandatory) return

    // Swallow the back press — there is no way to navigate away from this gate.
    BackHandler(enabled = true) {}

    AlertDialog(
        onDismissRequest = { /* not dismissable */ },
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
        ),
        icon = {
            Icon(
                Icons.Filled.SystemUpdate,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
        },
        title = { Text("Update required", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "A new version (v${ua.release.versionName}) is required to keep using the app. " +
                        "Please update to continue.",
                )
                ua.release.releaseNotes?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall)
                }
                if (downloading) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Downloading… you'll get a notification when it's ready to install.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                installError?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    vm.clearInstallError()
                    vm.install(ua.release)
                },
                enabled = !downloading,
            ) {
                if (downloading) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("Update now")
                }
            }
        },
    )
}
