@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package com.tutelage.crm.counsellor.ui.leads

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallMade
import androidx.compose.material.icons.filled.CallMissed
import androidx.compose.material.icons.filled.CallReceived
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.outlined.Note
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import timber.log.Timber
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.calls.CallEntity
import com.tutelage.crm.counsellor.data.leads.FlagMessageDto
import com.tutelage.crm.counsellor.data.leads.FollowupCreateBody
import com.tutelage.crm.counsellor.data.leads.FollowupRecordDto
import com.tutelage.crm.counsellor.data.leads.DepartmentDto
import com.tutelage.crm.counsellor.data.leads.LeadCommentDto
import com.tutelage.crm.counsellor.data.leads.LeadDetailDto
import com.tutelage.crm.counsellor.data.leads.LeadFollowupStatusDto
import com.tutelage.crm.counsellor.data.leads.LeadNoteDto
import com.tutelage.crm.counsellor.data.leads.LeadStatusDto
import com.tutelage.crm.counsellor.data.leads.StatusHistoryDto
import com.tutelage.crm.counsellor.data.leads.TimelineEntryDto
import com.tutelage.crm.counsellor.util.maskPhone
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun LeadDetailScreen(
    leadId: Long,
    onBack: () -> Unit,
    vm: LeadDetailViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme

    LaunchedEffect(leadId) { vm.bind(leadId) }
    DisposableEffect(Unit) {
        vm.startPolling()
        onDispose { vm.stopPolling() }
    }

    // Surface success / error from mutations as Toasts too. The MessageBanner
    // banner-style UI is easy to miss when the user is mid-scroll; Toasts make
    // failures (e.g. "Not assigned to this lead") impossible to overlook.
    LaunchedEffect(state.message) {
        state.message?.let {
            android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let {
            android.widget.Toast.makeText(context, it, android.widget.Toast.LENGTH_LONG).show()
        }
    }

    // remember(leadId): callsForLead() builds a NEW stateIn flow on every call,
    // so collecting it straight from the composition body tore down and
    // restarted the Room subscription on each recomposition — and every
    // abandoned one held its upstream open for the 5s WhileSubscribed grace.
    val callsFlow = remember(leadId) { vm.callsForLead(leadId) }
    val calls by callsFlow.collectAsStateWithLifecycle(initialValue = emptyList())

    var pendingPhone by remember { mutableStateOf<String?>(null) }
    var showAddNote by remember { mutableStateOf(false) }
    var showAddFollowup by remember { mutableStateOf(false) }
    var showFlagDialog by remember { mutableStateOf(false) }

    /**
     * Every outbound intent from this screen carries the lead's phone number in
     * its URI, so an unguarded startActivity is two bugs at once: it crashes the
     * app when no handler exists (an `sms:` with no messaging app, a revoked
     * CALL_PHONE racing our own permission gate), and the resulting
     * ActivityNotFoundException message —
     * `No Activity found to handle Intent { act=... dat=sms:9876543210 }` —
     * carries the full number into Crashlytics as an uncaught fatal, past the
     * masking the rest of the app enforces. Same helper FilterBatchDetailScreen
     * already uses.
     */
    fun safeStart(intent: Intent, failMsg: String) {
        runCatching { context.startActivity(intent) }
            .onFailure {
                Timber.w("Lead action failed: %s", failMsg)
                android.widget.Toast.makeText(context, failMsg, android.widget.Toast.LENGTH_SHORT).show()
            }
    }

    fun placeCall(phone: String) {
        vm.beginOutgoingCall(leadId, phone)
        safeStart(
            Intent(Intent.ACTION_CALL, Uri.parse("tel:$phone")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            "Couldn't start the call",
        )
    }

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { granted ->
        val callOk = granted[Manifest.permission.CALL_PHONE] == true
        val phone = pendingPhone
        pendingPhone = null
        if (callOk && phone != null) {
            placeCall(phone)
        } else if (phone != null) {
            safeStart(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")), "No phone app available")
        }
    }

    fun requestCall(phone: String) {
        val needed = arrayOf(
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG,
        )
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) placeCall(phone)
        else {
            pendingPhone = phone
            permLauncher.launch(missing.toTypedArray())
        }
    }

    fun openSms(phone: String) =
        safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("sms:$phone")), "No SMS app available")

    fun openWhatsApp(phone: String) {
        val digits = phone.filter { it.isDigit() }
        safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")), "WhatsApp not available")
    }

    Scaffold(
        containerColor = cs.background,
        topBar = {
            TopAppBar(
                title = { Text(state.lead?.name ?: "Lead") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = cs.onPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = cs.primary,
                    titleContentColor = cs.onPrimary,
                ),
            )
        },
    ) { padding ->
        val l = state.lead
        if (l == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                if (state.loading) CircularProgressIndicator()
                else Text(
                    state.error ?: "Lead not found.",
                    color = cs.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )
            }
            return@Scaffold
        }
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            state.message?.let { MessageBanner(it, isError = false, onDismiss = vm::clearMessage) }
            state.error?.let { MessageBanner(it, isError = true, onDismiss = vm::clearMessage) }

            HeaderCard(l)

            l.mobile?.takeIf { it.isNotBlank() }?.let { phone ->
                QuickActionsRow(
                    onCall = { requestCall(phone) },
                    onSms = { openSms(phone) },
                    onWhatsApp = { openWhatsApp(phone) },
                )
            }

            StatusCard(lead = l)

            ActionButtonsCard(
                isFlagged = (l.flagRcv ?: 0) == 1,
                saving = state.saving,
                onAddFollowup = { showAddFollowup = true },
                onAddNote = { showAddNote = true },
                onToggleFlag = { showFlagDialog = true },
            )

            TimelineCard(entries = state.timeline)

            FollowupsHistoryCard(items = state.followups)

            FlagHistoryCard(messages = state.flagMessages, isFlagged = (l.flagRcv ?: 0) == 1)

            StatusHistoryCard(history = state.history)

            DetailsCard(l)

            // NotesCard(notes = state.notes, onAdd = { showAddNote = true })

            CallHistoryCard(calls)

            Spacer(Modifier.height(8.dp))
        }

        if (showAddNote) {
            AddNoteDialog(
                onConfirm = { text ->
                    showAddNote = false
                    vm.addNote(text)
                },
                onDismiss = { showAddNote = false },
            )
        }
        if (showAddFollowup) {
            AddFollowupDialog(
                lead = l,
                departments = state.config.departments,
                statuses = state.config.statuses,
                followupStatuses = state.config.followupStatuses,
                lastComment = state.followups.firstOrNull()?.comment,
                onConfirm = { body ->
                    showAddFollowup = false
                    vm.addFollowup(body)
                },
                onDismiss = { showAddFollowup = false },
            )
        }
        if (showFlagDialog) {
            val isFlagged = (l.flagRcv ?: 0) == 1
            FlagDialog(
                isFlagged = isFlagged,
                onConfirm = { msg ->
                    showFlagDialog = false
                    vm.toggleFlag(msg)
                },
                onDismiss = { showFlagDialog = false },
            )
        }
    }
}

// ── Components ────────────────────────────────────────────────────────────────

@Composable
private fun MessageBanner(text: String, isError: Boolean, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isError) cs.errorContainer else cs.tertiaryContainer,
        ),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text,
                color = if (isError) cs.onErrorContainer else cs.onTertiaryContainer,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text("OK") }
        }
    }
}

@Composable
private fun HeaderCard(l: LeadDetailDto) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AvatarCircle(name = l.name, size = 56)
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    l.name?.takeIf { it.isNotBlank() } ?: "(unnamed)",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                )
                l.mobile?.takeIf { it.isNotBlank() }?.let {
                    Text(maskPhone(it), style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant)
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(top = 6.dp),
                ) {
                    l.leadStatus?.takeIf { it.isNotBlank() }?.let { Pill(it, primary = true) }
                    l.intrestedCourse?.takeIf { it.isNotBlank() }?.let { Pill(it) }
                }
            }
        }
    }
}

@Composable
private fun StatusCard(lead: LeadDetailDto) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionTitle("Lead status")
            Column {
                Text(
                    "STATUS",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                Text(
                    listOfNotNull(
                        lead.leadStatus?.takeIf { it.isNotBlank() },
                        lead.leadSubStatus?.takeIf { it.isNotBlank() },
                    ).joinToString(" • ").ifBlank { "Not set" },
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
            // Read-only — counsellor edits the next follow-up via the
            // "Follow-up" button in Quick actions, not from here.
            Column {
                Text(
                    "NEXT FOLLOW-UP",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                Text(
                    formatFollowupDate(lead.followupDate) ?: "Not scheduled",
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

@Composable
private fun NotesCard(notes: List<LeadNoteDto>, onAdd: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("Notes")
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onAdd) { Text("+ Add note") }
            }
            if (notes.isEmpty()) {
                Text("No notes yet.", style = MaterialTheme.typography.bodySmall, color = cs.outline)
            } else {
                notes.take(20).forEach { note ->
                    Row(verticalAlignment = Alignment.Top) {
                        Icon(
                            Icons.Outlined.Note,
                            contentDescription = null,
                            tint = cs.primary,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(note.note, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                buildString {
                                    note.userName?.let { append(it); append(" • ") }
                                    append(formatNoteDate(note.createdAt))
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = cs.outline,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Reusable dropdown picker — built on a plain clickable Surface + DropdownMenu
 *  so the click target is unambiguous on every OEM. The ExposedDropdownMenuBox
 *  variant misfires on some devices (popup opens then drops the selection). */
@Composable
private fun <T> DropdownField(
    label: String,
    options: List<T>,
    selectedId: Long?,
    optionId: (T) -> Long,
    optionLabel: (T) -> String,
    onSelected: (T?) -> Unit,
    enabled: Boolean = true,
    placeholder: String = "Select…",
) {
    var expanded by remember { mutableStateOf(false) }
    val selected = options.firstOrNull { optionId(it) == selectedId }
    val displayText = selected?.let(optionLabel) ?: placeholder
    val cs = MaterialTheme.colorScheme

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = cs.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, bottom = 4.dp),
        )
        Box {
            Surface(
                onClick = { if (enabled) expanded = true },
                enabled = enabled,
                shape = RoundedCornerShape(12.dp),
                color = if (enabled) cs.surface else cs.surfaceVariant,
                tonalElevation = 1.dp,
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    if (enabled) cs.outline.copy(alpha = 0.5f) else cs.outline.copy(alpha = 0.2f),
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        displayText,
                        modifier = Modifier.weight(1f),
                        color = if (selected != null) cs.onSurface else cs.outline,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Icon(
                        Icons.Default.Edit,
                        contentDescription = null,
                        tint = cs.primary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                modifier = Modifier
                    .fillMaxWidth(0.9f)
                    .
                    heightIn(max = 250.dp),
            ) {
                options.forEach { opt ->
                    DropdownMenuItem(
                        text = { Text(optionLabel(opt)) },
                        onClick = {
                            onSelected(opt)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun RadioRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.material3.RadioButton(selected = selected, onClick = onClick)
        Spacer(Modifier.width(8.dp))
        Text(label, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun FollowupDatePickerDialog(
    initialMillis: Long?,
    onConfirm: (Long) -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit,
) {
    // Follow-ups are scheduled ahead of time — block back-dating, same as the website.
    val todayUtcMillis = remember {
        java.time.LocalDate.now(java.time.ZoneOffset.UTC)
            .atStartOfDay(java.time.ZoneOffset.UTC)
            .toInstant()
            .toEpochMilli()
    }
    val selectableDates = remember(todayUtcMillis) {
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                utcTimeMillis >= todayUtcMillis
        }
    }
    val pickerState = rememberDatePickerState(
        initialSelectedDateMillis = initialMillis?.takeIf { it >= todayUtcMillis },
        selectableDates = selectableDates,
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                enabled = pickerState.selectedDateMillis != null,
                onClick = { pickerState.selectedDateMillis?.let(onConfirm) },
            ) { Text("Set") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onClear) { Text("Clear") }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    ) { DatePicker(state = pickerState) }
}

@Composable
private fun AddNoteDialog(onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add note") },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("Type your note…") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                enabled = text.trim().isNotEmpty(),
                onClick = { onConfirm(text) },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun QuickActionsRow(onCall: () -> Unit, onSms: () -> Unit, onWhatsApp: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Button(
            onClick = onCall,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.weight(1f).height(48.dp),
        ) {
            Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Call", style = MaterialTheme.typography.labelLarge)
        }
        Button(
            onClick = onSms,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = cs.secondaryContainer,
                contentColor = cs.onSecondaryContainer,
            ),
            modifier = Modifier.weight(1f).height(48.dp),
        ) {
            Icon(Icons.Outlined.Sms, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("SMS", style = MaterialTheme.typography.labelLarge)
        }
        Button(
            onClick = onWhatsApp,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFF25D366).copy(alpha = 0.15f),
                contentColor = Color(0xFF1EA952),
            ),
            elevation = ButtonDefaults.buttonElevation(0.dp),
            modifier = Modifier.weight(1f).height(48.dp),
        ) {
            Icon(Icons.AutoMirrored.Outlined.Chat, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("WhatsApp", style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun ActionButton(
    label: String,
    icon: ImageVector,
    container: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // Deprecated: Kept around just in case it's used elsewhere, but QuickActionsRow now uses standard Buttons.
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = container,
        modifier = modifier.height(64.dp),
    ) {
        Column(
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(8.dp),
        ) {
            Icon(icon, contentDescription = null, tint = Color.White)
            Spacer(Modifier.height(2.dp))
            Text(label, color = Color.White, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

@Composable
private fun DetailsCard(l: LeadDetailDto) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            SectionTitle("Lead Info")
            Spacer(Modifier.height(12.dp))
            
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(cs.surfaceVariant.copy(alpha = 0.5f))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Field("Mobile", l.mobile?.let { maskPhone(it) })
                Field("Alt Mobile", l.mobile2?.takeIf { it.isNotBlank() }?.let { maskPhone(it) })
                Field("Email", l.email?.takeIf { it.isNotBlank() })

                val hasLocation = !l.city.isNullOrBlank() || !l.state.isNullOrBlank()
                if (hasLocation) {
                    androidx.compose.material3.HorizontalDivider(color = cs.outlineVariant.copy(alpha = 0.5f))
                    Field("Location", listOfNotNull(l.city?.takeIf { it.isNotBlank() }, l.state?.takeIf { it.isNotBlank() }).joinToString(", "))
                }
                if (!l.intrestedCourse.isNullOrBlank()) {
                    androidx.compose.material3.HorizontalDivider(color = cs.outlineVariant.copy(alpha = 0.5f))
                    Field("Course", l.intrestedCourse)
                }
            }
        }
    }
}

@Composable
private fun CallHistoryCard(calls: List<CallEntity>) {
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            SectionTitle("Call history")
            Spacer(Modifier.height(8.dp))
            if (calls.isEmpty()) {
                Text("No calls yet", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    calls.forEachIndexed { idx, it ->
                        CallRow(it)
                        if (idx < calls.lastIndex) {
                            androidx.compose.material3.HorizontalDivider(
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
                                modifier = Modifier.padding(start = 46.dp, top = 8.dp, bottom = 8.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CallRow(call: CallEntity) {
    val cs = MaterialTheme.colorScheme
    val (icon, tint) = when (call.direction.uppercase()) {
        "OUTGOING" -> Icons.Default.CallMade to cs.tertiary
        "INCOMING" -> Icons.Default.CallReceived to cs.secondary
        else -> Icons.Default.CallMissed to cs.error
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier.size(36.dp).clip(CircleShape).background(tint.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = tint) }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "${call.direction.lowercase().replaceFirstChar { it.uppercase() }} · ${call.status.lowercase().replaceFirstChar { it.uppercase() }}",
                style = MaterialTheme.typography.labelMedium,
            )
            Text(
                "${formatDate(call.startedAt)} · ${formatDuration(call.durationSec)}",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
        color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
private fun Pill(text: String, primary: Boolean = false) {
    val cs = MaterialTheme.colorScheme
    val (bg, fg) = if (primary) cs.primaryContainer to cs.onPrimaryContainer
    else cs.secondaryContainer to cs.onSecondaryContainer
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Text(
            text,
            color = fg,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun Field(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.weight(0.35f)
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
            modifier = Modifier.weight(0.65f)
        )
    }
}

private val DATE_FMT = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())
private val FU_FMT = SimpleDateFormat("dd MMM yyyy", Locale.getDefault())
private val NOTE_FMT = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())
private fun formatDate(ms: Long) = DATE_FMT.format(Date(ms))
private fun formatDuration(sec: Int): String {
    if (sec <= 0) return "—"
    val m = sec / 60
    val s = sec % 60
    return if (m > 0) "${m}m ${s}s" else "${s}s"
}

private fun parseIsoToMillis(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull()
}
private fun formatFollowupDate(iso: String?): String? {
    val ms = parseIsoToMillis(iso) ?: return null
    return FU_FMT.format(Date(ms))
}
private fun formatNoteDate(iso: String?): String {
    val ms = parseIsoToMillis(iso) ?: return ""
    return NOTE_FMT.format(Date(ms))
}

// ── New section composables for full CRM parity ──────────────────────────────

@Composable
private fun ActionButtonsCard(
    isFlagged: Boolean,
    saving: Boolean,
    onAddFollowup: () -> Unit,
    onAddNote: () -> Unit,
    onToggleFlag: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle("Quick actions")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = onAddFollowup,
                    enabled = !saving,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.weight(1f),
                ) { Text("Follow-up", style = MaterialTheme.typography.labelMedium) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                /*
                Button(
                    onClick = onAddNote,
                    enabled = !saving,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = cs.tertiaryContainer,
                        contentColor = cs.onTertiaryContainer,
                    ),
                    modifier = Modifier.weight(1f),
                ) { Text("Note", style = MaterialTheme.typography.labelMedium) }
                */
                Button(
                    onClick = onToggleFlag,
                    enabled = !saving,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isFlagged) cs.error else cs.errorContainer,
                        contentColor = if (isFlagged) cs.onError else cs.onErrorContainer,
                    ),
                    modifier = Modifier.weight(1f),
                ) {
                    Text(
                        if (isFlagged) "Unflag" else "Flag",
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun TimelineCard(entries: List<TimelineEntryDto>) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle("Activity timeline")
            if (entries.isEmpty()) {
                Text("No activity yet.", style = MaterialTheme.typography.bodySmall, color = cs.outline)
            } else {
                val list = entries.take(50)
                list.forEachIndexed { idx, e ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(bottom = if (idx == list.lastIndex) 0.dp else 16.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(end = 12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 4.dp)
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(timelineColor(e.type, cs)),
                            )
                            // Draw a subtle connecting line to the next item
                            if (idx < list.lastIndex) {
                                Box(
                                    modifier = Modifier
                                        .padding(top = 4.dp)
                                        .width(2.dp)
                                        .height(48.dp)
                                        .background(cs.outlineVariant.copy(alpha = 0.5f))
                                )
                            }
                        }
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(cs.surfaceVariant.copy(alpha = 0.3f))
                                .padding(12.dp)
                        ) {
                            Text(
                                timelineLabel(e.type),
                                style = MaterialTheme.typography.labelSmall,
                                color = timelineColor(e.type, cs),
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(e.summary, style = MaterialTheme.typography.bodyMedium)
                            e.detail?.takeIf { it.isNotBlank() }?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                            }
                            Text(
                                buildString {
                                    e.byName?.let { append(it); append(" • ") }
                                    append(formatNoteDate(e.at))
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = cs.outline,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun timelineLabel(type: String): String = when (type) {
    "status" -> "STATUS"
    "followup" -> "FOLLOW-UP"
    "note" -> "NOTE"
    "comment" -> "COMMENT"
    "call" -> "CALL"
    "flag" -> "FLAG"
    else -> type.uppercase()
}

@Composable
private fun timelineColor(type: String, cs: androidx.compose.material3.ColorScheme): Color = when (type) {
    "status" -> cs.primary
    "followup" -> cs.tertiary
    "note" -> cs.secondary
    "comment" -> Color(0xFF8B5CF6)
    "call" -> Color(0xFF10B981)
    "flag" -> cs.error
    else -> cs.outline
}

@Composable
private fun FollowupsHistoryCard(items: List<FollowupRecordDto>) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle("Follow-up history")
            if (items.isEmpty()) {
                Text("No follow-ups yet.", style = MaterialTheme.typography.bodySmall, color = cs.outline)
            } else {
                items.take(30).forEach { f ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(cs.tertiaryContainer.copy(alpha = 0.3f))
                            .padding(12.dp)
                    ) {
                        f.comment?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        Text(
                            buildString {
                                f.user?.name?.let { append(it); append(" • ") }
                                append(formatNoteDate(f.createdAt))
                                f.followupDate?.let {
                                    append(" • Next: ")
                                    append(formatFollowupDate(it) ?: "")
                                }
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = cs.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CommentsCard(comments: List<LeadCommentDto>, onAdd: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionTitle("Comments")
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onAdd) { Text("+ Add") }
            }
            if (comments.isEmpty()) {
                Text("No comments yet.", style = MaterialTheme.typography.bodySmall, color = cs.outline)
            } else {
                comments.take(20).forEach { c ->
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Text(c.comment, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            buildString {
                                c.userName?.let { append(it); append(" • ") }
                                append(formatNoteDate(c.createdAt))
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = cs.outline,
                        )
                        Spacer(Modifier.height(4.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun FlagHistoryCard(messages: List<FlagMessageDto>, isFlagged: Boolean) {
    if (messages.isEmpty() && !isFlagged) return
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isFlagged) cs.errorContainer else cs.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionTitle(if (isFlagged) "🚩 Currently flagged" else "Flag history")
            if (messages.isEmpty()) {
                Text("No flag messages.", style = MaterialTheme.typography.bodySmall, color = cs.outline)
            } else {
                messages.take(20).forEach { m ->
                    Column {
                        Text(m.message, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            buildString {
                                m.userName?.let { append(it); append(" • ") }
                                append("(${m.type}) • ")
                                append(formatNoteDate(m.createdAt))
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isFlagged) cs.onErrorContainer else cs.outline,
                        )
                        Spacer(Modifier.height(4.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusHistoryCard(history: List<StatusHistoryDto>) {
    if (history.isEmpty()) return
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionTitle("Status history")
            history.take(20).forEach { h ->
                Column {
                    Text(
                        "${h.fromStatus ?: "—"} → ${h.toStatus}" +
                            (h.toSubStatus?.let { " ($it)" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        buildString {
                            h.byName?.let { append(it); append(" • ") }
                            h.source?.let { append("via $it • ") }
                            append(formatNoteDate(h.createdAt))
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.outline,
                    )
                    Spacer(Modifier.height(4.dp))
                }
            }
        }
    }
}

@Composable
private fun SimpleTextDialog(
    title: String,
    placeholder: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text(placeholder) },
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                enabled = text.trim().isNotEmpty(),
                onClick = { onConfirm(text) },
            ) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun FlagDialog(
    isFlagged: Boolean,
    onConfirm: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var message by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isFlagged) "Clear flag?" else "Flag this lead to admin") },
        text = {
            if (!isFlagged) {
                Column {
                    Text(
                        "Add a short reason so the admin knows why you're flagging.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = message,
                        onValueChange = { message = it },
                        placeholder = { Text("Reason (optional)") },
                        minLines = 2,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            } else {
                Text("This will remove the flag.")
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(message.trim().ifBlank { null }) }) {
                Text(if (isFlagged) "Clear flag" else "Flag")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun AddFollowupDialog(
    lead: LeadDetailDto,
    departments: List<DepartmentDto>,
    statuses: List<LeadStatusDto>,
    followupStatuses: List<LeadFollowupStatusDto>,
    lastComment: String?,
    onConfirm: (FollowupCreateBody) -> Unit,
    onDismiss: () -> Unit,
) {
    // Pre-seed with the most recent follow-up's comment, same as the website.
    var comment by remember { mutableStateOf(lastComment.orEmpty()) }
    // Status is picked from the lead's own department, same as the website —
    // but a sub-status carrying `moveTo` can still relocate the lead to a
    // different department (the department itself is never a free-standing
    // dropdown on the website either).
    val homeDepartmentId = lead.departmentId
    val departmentStatuses = remember(homeDepartmentId, statuses) {
        statuses
            .filter { it.departmentId == homeDepartmentId && (it.status ?: 1) == 1 }
            .sortedWith(compareBy<LeadStatusDto>({ it.priority ?: Int.MAX_VALUE }, { it.title }))
    }
    // Default to the lead's current status/sub-status, same as the website.
    var selectedStatusId by remember { mutableStateOf(lead.leadStatusId) }
    var selectedSubStatusId by remember { mutableStateOf(lead.leadSubStatusId) }
    // Default to the lead's current follow-up status (Open/Reserved/Potential),
    // same as status/sub-status above.
    var selectedFollowStatusId by remember { mutableStateOf(lead.leadFollowStatus) }
    var followupMillis by remember { mutableStateOf<Long?>(null) }
    var showDatePicker by remember { mutableStateOf(false) }
    var answered by remember { mutableStateOf<Int?>(null) }

    val currentStatus = departmentStatuses.firstOrNull { it.id == selectedStatusId }
    val subs = currentStatus?.subStatuses?.sortedWith(compareBy { it.id }) ?: emptyList()
    val selectedSub = subs.firstOrNull { it.id == selectedSubStatusId }
    // moveTo (if set) wins over the lead's home department — mirrors the
    // website's `destination` cascade (pickedSub?.moveTo ?: pickedDeptId).
    val targetDepartmentId = selectedSub?.moveTo ?: homeDepartmentId
    val homeDepartment = departments.firstOrNull { it.id == homeDepartmentId }
    val targetDepartment = departments.firstOrNull { it.id == targetDepartmentId }
    val isMoving = targetDepartmentId != null && homeDepartmentId != null && targetDepartmentId != homeDepartmentId

    val dialogCs = MaterialTheme.colorScheme
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add follow-up", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Status section — department, status, sub-status.
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = dialogCs.surfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Column {
                            Text(
                                "DEPARTMENT",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = dialogCs.onSurfaceVariant,
                            )
                            Text(
                                departmentLabel(homeDepartment, homeDepartmentId),
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = FontWeight.Medium,
                                color = dialogCs.onSurface,
                            )
                        }

                        if (departmentStatuses.isNotEmpty()) {
                            DropdownField(
                                label = "Status *",
                                options = departmentStatuses,
                                selectedId = selectedStatusId,
                                optionId = { it.id },
                                optionLabel = { it.title },
                                onSelected = {
                                    selectedStatusId = it?.id
                                    selectedSubStatusId = null
                                },
                            )
                            DropdownField(
                                label = "Sub-status *",
                                options = subs,
                                selectedId = selectedSubStatusId,
                                optionId = { it.id },
                                optionLabel = { it.subStatus },
                                onSelected = { selectedSubStatusId = it?.id },
                                enabled = subs.isNotEmpty(),
                                placeholder = if (subs.isEmpty()) "No sub-statuses" else "Select...",
                            )
                            if (isMoving) {
                                Text(
                                    "This will move the lead to ${departmentLabel(targetDepartment, targetDepartmentId)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.Medium,
                                    color = dialogCs.primary,
                                )
                            }
                        }
                    }
                }

                // Follow-up details section — date + follow-up status.
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = dialogCs.surfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    "NEXT FOLLOW-UP DATE *",
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = dialogCs.onSurfaceVariant,
                                )
                                Text(
                                    followupMillis?.let { formatFollowupDate(java.time.Instant.ofEpochMilli(it).toString()) } ?: "Not set",
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontWeight = FontWeight.Medium,
                                    color = if (followupMillis != null) dialogCs.onSurface else dialogCs.error,
                                )
                            }
                            Button(
                                onClick = { showDatePicker = true },
                                shape = RoundedCornerShape(12.dp),
                            ) { Text("Next date") }
                        }

                        // Answered toggle — commented out, not in use.
                        /*
                        Text("Call answered?", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(
                                "Not set" to null,
                                "Yes" to 1,
                                "No" to 0,
                            ).forEach { (label, v) ->
                                FilterChipLike(
                                    label = label,
                                    selected = answered == v,
                                    onClick = { answered = v },
                                )
                            }
                        }
                        */

                        if (followupStatuses.isNotEmpty()) {
                            DropdownField(
                                label = "Follow-up status",
                                options = followupStatuses,
                                selectedId = selectedFollowStatusId,
                                optionId = { it.id },
                                optionLabel = { it.status ?: "Status ${it.id}" },
                                onSelected = { selectedFollowStatusId = it?.id },
                            )
                        }
                    }
                }

                // Comment comes last, after all the follow-up details are set.
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    label = { Text("Comment *") },
                    placeholder = { Text("What happened on this follow-up?") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                enabled = comment.trim().isNotEmpty() && 
                        selectedStatusId != null && 
                        (subs.isEmpty() || selectedSubStatusId != null) &&
                        followupMillis != null,
                onClick = {
                    onConfirm(
                        FollowupCreateBody(
                            comment = comment.trim(),
                            followupDate = followupMillis?.let { java.time.Instant.ofEpochMilli(it).toString() },
                            leadStatusId = selectedStatusId,
                            leadSubStatusId = selectedSubStatusId,
                            departmentId = targetDepartmentId,
                            callAnsweredStatus = answered,
                            leadFollowStatus = selectedFollowStatusId,
                            type = "followup",
                        )
                    )
                }
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )

    if (showDatePicker) {
        FollowupDatePickerDialog(
            initialMillis = followupMillis,
            onConfirm = { ms ->
                followupMillis = ms
                showDatePicker = false
            },
            onClear = {
                followupMillis = null
                showDatePicker = false
            },
            onDismiss = { showDatePicker = false },
        )
    }
}

private fun departmentLabel(department: DepartmentDto?, fallbackId: Long?): String =
    department?.name?.takeIf { it.isNotBlank() }
        ?: department?.title?.takeIf { it.isNotBlank() }
        ?: fallbackId?.let { "Department $it" }
        ?: "Not set"

@Composable
private fun FilterChipLike(label: String, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = if (selected) cs.primary else cs.surface,
        border = if (selected) null else androidx.compose.foundation.BorderStroke(1.dp, cs.outline.copy(alpha = 0.5f)),
    ) {
        Text(
            label,
            color = if (selected) cs.onPrimary else cs.onSurface,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
        )
    }
}
