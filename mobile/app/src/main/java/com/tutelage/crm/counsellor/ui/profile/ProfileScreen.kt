@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun ProfileScreen(
    onLogout: () -> Unit,
    vm: ProfileViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val cs = MaterialTheme.colorScheme

    Scaffold(
        containerColor = cs.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Profile",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = cs.primary,
                    titleContentColor = cs.onPrimary,
                ),
            )
        },
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            item { ProfileHeader(name = state.name, email = state.email, role = state.role) }
            item {
                Card(
                    shape = RoundedCornerShape(20.dp),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    colors = CardDefaults.cardColors(containerColor = cs.surface),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        InfoRow(Icons.Outlined.Email, "Email", state.email ?: "—")
                        InfoRow(Icons.Outlined.Phone, "Mobile", state.mobile ?: "—")
                        InfoRow(Icons.Outlined.VerifiedUser, "Role", state.role?.replaceFirstChar { it.uppercase() } ?: "Counsellor")
                        InfoRow(
                            Icons.Outlined.Info,
                            "App version",
                            "v${state.currentVersionName} (${state.currentVersionCode})",
                        )
                    }
                }
            }
            item {
                UpdateCard(
                    state = state,
                    onCheck = { vm.checkForUpdate(silent = false) },
                    onInstall = { vm.downloadAndInstall() },
                )
            }
            item { Spacer(Modifier.height(8.dp)) }
            item {
                Button(
                    onClick = { vm.logout(onLogout) },
                    shape = RoundedCornerShape(14.dp),
                    enabled = !state.loggingOut,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = cs.errorContainer,
                        contentColor = cs.onErrorContainer,
                    ),
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text(
                        if (state.loggingOut) "Signing out…" else "Sign out",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    )
                }
            }
        }
    }
}

@Composable
private fun ProfileHeader(name: String?, email: String?, role: String?) {
    val initials = (name ?: "?").split(" ").filter { it.isNotBlank() }.take(2)
        .joinToString("") { it.first().uppercase() }.ifBlank { "?" }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(com.tutelage.crm.counsellor.ui.theme.BrandGradient)
            .padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .background(Color.White.copy(alpha = 0.22f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initials,
                    color = Color.White,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.size(14.dp))
            Column {
                Text(
                    name ?: "—",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = Color.White,
                )
                Text(
                    email ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.85f),
                )
                androidx.compose.material3.Surface(
                    shape = RoundedCornerShape(50),
                    color = Color.White.copy(alpha = 0.22f),
                    modifier = Modifier.padding(top = 6.dp),
                ) {
                    Text(
                        (role ?: "counsellor").replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun UpdateCard(

    state: ProfileUiState,
    onCheck: () -> Unit,
    onInstall: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val latest = state.updateAvailable
    val hasUpdate = latest != null
    Card(
        shape = RoundedCornerShape(20.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (hasUpdate) cs.primaryContainer else cs.surface,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.SystemUpdate,
                    contentDescription = null,
                    tint = if (hasUpdate) cs.onPrimaryContainer else cs.primary,
                )
                Spacer(Modifier.size(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (hasUpdate) "Update available" else "App is up to date",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = if (hasUpdate) cs.onPrimaryContainer else cs.onSurface,
                    )
                    Text(
                        if (hasUpdate) {
                            "New version v${latest!!.versionName} ready to install"
                        } else {
                            "Current: v${state.currentVersionName}"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (hasUpdate) cs.onPrimaryContainer else cs.onSurfaceVariant,
                    )
                }
            }
            if (hasUpdate && !latest!!.releaseNotes.isNullOrBlank()) {
                Text(
                    latest.releaseNotes!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onPrimaryContainer,
                )
            }
            state.updateMessage?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (hasUpdate) cs.onPrimaryContainer else cs.onSurfaceVariant,
                )
            }
            if (hasUpdate) {
                Button(
                    onClick = onInstall,
                    enabled = !state.downloading,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = cs.primary,
                        contentColor = cs.onPrimary,
                    ),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) {
                    Text(
                        if (state.downloading) "Downloading…" else "Install latest update",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    )
                }
            } else {
                Button(
                    onClick = onCheck,
                    enabled = !state.checkingUpdate,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = cs.secondaryContainer,
                        contentColor = cs.onSecondaryContainer,
                    ),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) {
                    Text(
                        if (state.checkingUpdate) "Checking…" else "Check for updates",
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    )
                }
            }
        }
    }
}

@Composable
private fun InfoRow(icon: ImageVector, label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.size(12.dp))
        Column {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            Text(value, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
