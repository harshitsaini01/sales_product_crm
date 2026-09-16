@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.calls

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CallMade
import androidx.compose.material.icons.automirrored.outlined.CallMissed
import androidx.compose.material.icons.automirrored.outlined.CallReceived
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowRight
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sync
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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.tutelage.crm.counsellor.ui.components.StatValue
import com.tutelage.crm.counsellor.util.toLocaleString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.dashboard.CallLogRowDto
import com.tutelage.crm.counsellor.data.dashboard.CallLogSummaryDto
import com.tutelage.crm.counsellor.util.maskPhone
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

// Same dark gradient as the Home hero — keeps the brand consistent.
private val HeaderGradient: Brush = Brush.linearGradient(
    colors = listOf(
        Color(0xFF0B1029),
        Color(0xFF312E81),
        Color(0xFF6D28D9),
    ),
)

// Professional, semantic call-direction palette. Not from the material theme
// so dark / light modes look identical (avoids low-contrast tertiary etc).
private val ColorOutgoing = Color(0xFF10B981) // emerald-500
private val ColorIncoming = Color(0xFF0EA5E9) // sky-500
private val ColorMissed   = Color(0xFFEF4444) // red-500
private val ColorRejected = Color(0xFFF59E0B) // amber-500
private val ColorRecording = Color(0xFF8B5CF6) // violet-500

private data class StatusOption(val value: String, val label: String)
private val STATUS_OPTIONS = listOf(
    StatusOption("", "All statuses"),
    StatusOption("ANSWERED", "Answered"),
    StatusOption("MISSED", "Missed"),
    StatusOption("NO_ANSWER", "No answer"),
    StatusOption("REJECTED", "Rejected"),
    StatusOption("BUSY", "Busy"),
    StatusOption("FAILED", "Failed"),
    StatusOption("RINGING", "Ringing"),
)
private val DIRECTION_OPTIONS = listOf(
    StatusOption("", "All directions"),
    StatusOption("OUTGOING", "Outgoing"),
    StatusOption("INCOMING", "Incoming"),
)

@Composable
fun CallsScreen(vm: CallsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val pendingUploads by vm.pendingUploads.collectAsStateWithLifecycle()
    val pendingSync by vm.pendingSync.collectAsStateWithLifecycle()
    val cs = MaterialTheme.colorScheme

    val ctx = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(state.message) {
        val msg = state.message ?: return@LaunchedEffect
        android.widget.Toast.makeText(ctx, msg, android.widget.Toast.LENGTH_LONG).show()
        vm.consumeMessage()
    }

    Scaffold(containerColor = cs.background) { padding ->
        // The whole screen scrolls as one — the filter chrome scrolls off and
        // the cards take centre stage, just like the web page.
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            item(key = "__header__") {
                CallsHeader(
                    today = state.today,
                    refreshing = state.refreshing,
                    forceSeeding = state.forceSeeding,
                    lastSyncedAtMs = state.lastSyncedAtMs,
                    onRefresh = vm::pullToRefresh,
                    onForceSync = vm::forceSyncToday,
                )
            }

            item(key = "__search__") {
                SearchAndFilterToggle(
                    searchInput = state.searchInput,
                    activeFilterCount = computeActiveFilterCount(state),
                    filtersExpanded = state.filtersExpanded,
                    onSearchChange = vm::setSearch,
                    onToggleFilters = vm::toggleFiltersPanel,
                )
            }

            item(key = "__filters__") {
                FiltersPanel(
                    visible = state.filtersExpanded,
                    status = state.status,
                    direction = state.direction,
                    fromDate = state.fromDate,
                    toDate = state.toDate,
                    onStatus = vm::setStatus,
                    onDirection = vm::setDirection,
                    onFromDate = vm::setFromDate,
                    onToDate = vm::setToDate,
                    onReset = vm::clearFilters,
                )
            }

            item(key = "__quick__") {
                QuickRangeChips(
                    active = state.quickRange,
                    onSelect = vm::applyQuickRange,
                )
            }

            // Live status strip — only shows when something is in flight.
            item(key = "__pending__") {
                PendingStatusStrip(
                    pendingUploads = pendingUploads,
                    pendingSync = pendingSync,
                )
            }

            if (state.permissionsMissing) {
                item(key = "__perm_warning__") {
                    PermissionWarningBanner(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                    )
                }
            }

            item(key = "__progress__") {
                AnimatedVisibility(
                    visible = state.refreshing && state.rows.isNotEmpty(),
                    enter = fadeIn(),
                    exit = fadeOut(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().height(2.dp),
                        trackColor = Color.Transparent,
                    )
                }
            }

            // Filter-aware stat tiles (Matching, Answered, Missed, etc.). Click
            // a tile to toggle that status filter.
            item(key = "__stats__") {
                StatsRow(
                    summary = state.summary,
                    activeStatus = state.status,
                    onToggleStatus = vm::toggleStatus,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                )
            }

            // Results header — "1–500 of 2,341 · Today" feel.
            if (!(state.loading && state.rows.isEmpty())) {
                item(key = "__count__") {
                    ResultsHeader(
                        state = state,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                    )
                }
            }

            // Body — loading, empty, or list of cards.
            when {
                state.loading && state.rows.isEmpty() -> {
                    item(key = "__loading__") {
                        Box(
                            modifier = Modifier.fillMaxWidth().height(220.dp),
                            contentAlignment = Alignment.Center,
                        ) { CircularProgressIndicator() }
                    }
                }
                state.rows.isEmpty() -> {
                    item(key = "__empty__") {
                        EmptyCalls(
                            state = state,
                            onRetry = vm::pullToRefresh,
                            onReset = vm::clearFilters,
                        )
                    }
                }
                else -> {
                    state.error?.let { msg ->
                        item(key = "__error__") {
                            ErrorBanner(
                                msg,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                    items(items = state.rows, key = { it.id }) { row ->
                        CallLogCard(
                            row = row,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                }
            }

            // Pagination footer — only when we have results AND there's actually
            // more than one page (otherwise it's just visual noise).
            if (state.rows.isNotEmpty()) {
                item(key = "__pager__") {
                    PaginationFooter(
                        state = state,
                        onPageSize = vm::setPageSize,
                        onFirst = vm::firstPage,
                        onPrev = vm::prevPage,
                        onNext = vm::nextPage,
                        onLast = vm::lastPage,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
}

// ─── Header ──────────────────────────────────────────────────────────────────

@Composable
private fun CallsHeader(
    today: CallLogSummaryDto,
    refreshing: Boolean,
    forceSeeding: Boolean,
    lastSyncedAtMs: Long?,
    onRefresh: () -> Unit,
    onForceSync: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(HeaderGradient)
            .padding(horizontal = 20.dp, vertical = 18.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "Call activity",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                        ),
                        color = Color.White,
                    )
                    LiveSubtitle(
                        refreshing = refreshing,
                        lastSyncedAtMs = lastSyncedAtMs,
                    )
                }
                // Force-sync today: re-reads OS CallLog and ships any missing
                // rows / late-arriving recordings to the backend.
                Surface(
                    shape = CircleShape,
                    color = Color.White.copy(alpha = 0.18f),
                    modifier = Modifier
                        .size(40.dp)
                        .clickable(enabled = !forceSeeding, onClick = onForceSync),
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                        if (forceSeeding) {
                            CircularProgressIndicator(
                                color = Color.White,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(18.dp),
                            )
                        } else {
                            Icon(
                                Icons.Outlined.CloudUpload,
                                contentDescription = "Sync today's calls from phone",
                                tint = Color.White,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
                Surface(
                    shape = CircleShape,
                    color = Color.White.copy(alpha = 0.18f),
                    modifier = Modifier.size(40.dp).clickable(enabled = !refreshing, onClick = onRefresh),
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                        if (refreshing) {
                            CircularProgressIndicator(
                                color = Color.White,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(18.dp),
                            )
                        } else {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = "Refresh now",
                                tint = Color.White,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Today summary — independent of the active filter so counsellors
            // can always see "where am I today" regardless of what they filter.
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HeaderStat(
                    modifier = Modifier.weight(1f),
                    value = today.total.toString(),
                    label = "Today",
                )
                HeaderStat(
                    modifier = Modifier.weight(1f),
                    value = today.answered.toString(),
                    label = "Answered",
                    accent = ColorOutgoing,
                )
                HeaderStat(
                    modifier = Modifier.weight(1f),
                    value = today.missed.toString(),
                    label = "Missed",
                    accent = ColorMissed,
                )
                HeaderStat(
                    modifier = Modifier.weight(1f),
                    value = today.noAnswer.toString(),
                    label = "No answer",
                    accent = ColorMissed,
                )
            }
        }
    }
}

@Composable
private fun HeaderStat(
    modifier: Modifier = Modifier,
    value: String,
    label: String,
    accent: Color? = null,
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = Color.White.copy(alpha = 0.12f),
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.Start,
        ) {
            StatValue(
                text = value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = accent ?: Color.White,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.80f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun LiveSubtitle(refreshing: Boolean, lastSyncedAtMs: Long?) {
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    // 30s, not 1s. This label buckets into minutes, so a per-second tick
    // bought nothing and recomposed the header — item 0 of the list — 60x a
    // minute forever. A LaunchedEffect is not paused when the app is merely
    // backgrounded (the composition is retained), so it burned CPU off-screen
    // too.
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            nowMs = System.currentTimeMillis()
        }
    }
    val text = when {
        refreshing -> "Syncing latest calls…"
        lastSyncedAtMs == null -> "Today's snapshot"
        else -> {
            val ago = ((nowMs - lastSyncedAtMs) / 1000L).coerceAtLeast(0)
            val agoText = when {
                ago < 5 -> "just now"
                ago < 60 -> "${ago}s ago"
                ago < 3600 -> "${ago / 60}m ago"
                else -> "${ago / 3600}h ago"
            }
            "Live · synced $agoText"
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
        LivePulse()
        Spacer(Modifier.width(8.dp))
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.85f),
        )
    }
}

@Composable
private fun LivePulse() {
    // Driven by the Compose animation clock, not by writing state every 900ms.
    // The old loop invalidated this subtree ~66 times a minute forever, even
    // while the app was backgrounded; an InfiniteTransition is paused by the
    // framework and never triggers a real recomposition of the caller.
    val transition = rememberInfiniteTransition(label = "live-pulse")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.4f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "live-pulse-alpha",
    )
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(Color(0xFF34D399).copy(alpha = alpha)),
    )
}

// ─── Search + filter toggle ─────────────────────────────────────────────────

@Composable
private fun SearchAndFilterToggle(
    searchInput: String,
    activeFilterCount: Int,
    filtersExpanded: Boolean,
    onSearchChange: (String) -> Unit,
    onToggleFilters: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = searchInput,
            onValueChange = onSearchChange,
            placeholder = { Text("Search phone or lead name…", style = MaterialTheme.typography.bodyMedium) },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            trailingIcon = {
                if (searchInput.isNotEmpty()) {
                    Icon(
                        Icons.Outlined.Clear,
                        contentDescription = "Clear search",
                        modifier = Modifier.clickable { onSearchChange("") },
                    )
                }
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Search,
            ),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.weight(1f),
        )
        // Filters button — count badge if any non-default filter is set.
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = if (filtersExpanded) cs.primary else cs.surfaceVariant,
            modifier = Modifier
                .height(56.dp)
                .clickable(onClick = onToggleFilters),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    Icons.Outlined.FilterList,
                    contentDescription = "Filters",
                    tint = if (filtersExpanded) cs.onPrimary else cs.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
                if (activeFilterCount > 0) {
                    Surface(
                        shape = CircleShape,
                        color = if (filtersExpanded) cs.onPrimary.copy(alpha = 0.25f) else cs.primary,
                    ) {
                        Text(
                            activeFilterCount.toString(),
                            color = if (filtersExpanded) cs.onPrimary else cs.onPrimary,
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                    }
                }
                Icon(
                    if (filtersExpanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = null,
                    tint = if (filtersExpanded) cs.onPrimary else cs.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

private fun computeActiveFilterCount(s: CallsUiState): Int {
    var n = 0
    if (s.status.isNotEmpty()) n++
    if (s.direction.isNotEmpty()) n++
    if (s.fromDate.isNotEmpty() && s.quickRange == null) n++
    if (s.toDate.isNotEmpty() && s.quickRange == null) n++
    return n
}

// ─── Filters panel ──────────────────────────────────────────────────────────

@Composable
private fun FiltersPanel(
    visible: Boolean,
    status: String,
    direction: String,
    fromDate: String,
    toDate: String,
    onStatus: (String) -> Unit,
    onDirection: (String) -> Unit,
    onFromDate: (String) -> Unit,
    onToDate: (String) -> Unit,
    onReset: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    AnimatedVisibility(
        visible = visible,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
    ) {
        Surface(
            color = cs.surface,
            shape = RoundedCornerShape(16.dp),
            shadowElevation = 1.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(modifier = Modifier.weight(1f)) {
                        FilterDropdown(
                            label = "Status",
                            options = STATUS_OPTIONS,
                            selectedValue = status,
                            onSelect = onStatus,
                        )
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        FilterDropdown(
                            label = "Direction",
                            options = DIRECTION_OPTIONS,
                            selectedValue = direction,
                            onSelect = onDirection,
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(modifier = Modifier.weight(1f)) {
                        DateField(label = "From", value = fromDate, onChange = onFromDate)
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        DateField(label = "To", value = toDate, onChange = onToDate)
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = cs.surfaceVariant,
                        modifier = Modifier.clickable(onClick = onReset),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Outlined.Restore,
                                contentDescription = null,
                                tint = cs.onSurfaceVariant,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                "Reset filters",
                                color = cs.onSurfaceVariant,
                                style = MaterialTheme.typography.labelMedium.copy(
                                    fontWeight = FontWeight.Medium,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterDropdown(
    label: String,
    options: List<StatusOption>,
    selectedValue: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.value == selectedValue }?.label ?: options.first().label
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
    ) {
        OutlinedTextField(
            readOnly = true,
            value = selectedLabel,
            onValueChange = {},
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(),
            shape = RoundedCornerShape(12.dp),
        )
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(opt.label) },
                    onClick = {
                        onSelect(opt.value)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun DateField(label: String, value: String, onChange: (String) -> Unit) {
    var showPicker by remember { mutableStateOf(false) }
    OutlinedTextField(
        readOnly = true,
        value = value.ifEmpty { "—" },
        onValueChange = {},
        label = { Text(label) },
        leadingIcon = { Icon(Icons.Outlined.DateRange, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                Icon(
                    Icons.Outlined.Clear,
                    contentDescription = "Clear",
                    modifier = Modifier.clickable { onChange("") },
                )
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .clickable { showPicker = true },
        shape = RoundedCornerShape(12.dp),
    )
    if (showPicker) {
        val initialMillis = parseDateMillis(value) ?: System.currentTimeMillis()
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showPicker = false },
            confirmButton = {
                TextButton(
                    enabled = pickerState.selectedDateMillis != null,
                    onClick = {
                        pickerState.selectedDateMillis?.let {
                            onChange(formatDateMillis(it))
                        }
                        showPicker = false
                    },
                ) { Text("Set") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = {
                        onChange("")
                        showPicker = false
                    }) { Text("Clear") }
                    TextButton(onClick = { showPicker = false }) { Text("Cancel") }
                }
            },
        ) { DatePicker(state = pickerState) }
    }
}

// ─── Quick-range chips ──────────────────────────────────────────────────────

@Composable
private fun QuickRangeChips(active: QuickRange?, onSelect: (QuickRange) -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QuickRange.values().forEach { range ->
            val selected = active == range
            Surface(
                shape = RoundedCornerShape(50),
                color = if (selected) cs.primary else cs.surfaceVariant,
                modifier = Modifier.clickable { onSelect(range) },
            ) {
                Text(
                    range.label,
                    color = if (selected) cs.onPrimary else cs.onSurfaceVariant,
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    ),
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }
}

// ─── Stat tiles (clickable) ─────────────────────────────────────────────────

@Composable
private fun StatsRow(
    summary: CallLogSummaryDto,
    activeStatus: String,
    onToggleStatus: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Horizontal scroll so the row fits on any phone width and we don't lose
    // any tile to overflow. Each tile is fixed-width = 130dp.
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatTile(
            label = "Matching",
            value = summary.total.toLocaleString(),
            sub = "in this filter",
            active = false,
        )
        StatTile(
            label = "Answered",
            value = summary.answered.toLocaleString(),
            sub = connectRate(summary)?.let { "$it% rate" },
            accent = ColorOutgoing,
            active = activeStatus == "ANSWERED",
            onClick = { onToggleStatus("ANSWERED") },
        )
        StatTile(
            label = "Missed",
            value = summary.missed.toLocaleString(),
            accent = ColorMissed,
            active = activeStatus == "MISSED",
            onClick = { onToggleStatus("MISSED") },
        )
        StatTile(
            label = "No answer",
            value = summary.noAnswer.toLocaleString(),
            accent = ColorMissed,
            active = activeStatus == "NO_ANSWER",
            onClick = { onToggleStatus("NO_ANSWER") },
        )
        StatTile(
            label = "Rejected",
            value = summary.rejected.toLocaleString(),
            accent = ColorRejected,
            active = activeStatus == "REJECTED",
            onClick = { onToggleStatus("REJECTED") },
        )
        StatTile(
            label = "Talk time",
            value = formatHM(summary.totalSec.takeIf { it > 0 } ?: summary.talkSec),
            sub = if (summary.answered > 0)
                "avg ${formatHM(summary.answeredSec / summary.answered)}/call"
            else null,
            active = false,
        )
    }
}

@Composable
private fun StatTile(
    label: String,
    value: String,
    sub: String? = null,
    accent: Color? = null,
    active: Boolean,
    onClick: (() -> Unit)? = null,
) {
    val cs = MaterialTheme.colorScheme
    val borderColor = when {
        active -> cs.primary
        else -> Color.Transparent
    }
    val container = if (active) cs.primary.copy(alpha = 0.08f) else cs.surface
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = container,
        border = if (active) androidx.compose.foundation.BorderStroke(2.dp, borderColor) else null,
        modifier = Modifier
            .width(130.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    ) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = cs.onSurfaceVariant,
            )
            Spacer(Modifier.height(4.dp))
            // Fixed 130dp tile — a large formatted total ("1,24,567") wraps here
            // without shrink-to-fit and pushes the sub-label out of the card.
            StatValue(
                text = value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = accent ?: cs.onSurface,
                modifier = Modifier.fillMaxWidth(),
            )
            if (sub != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    sub,
                    style = MaterialTheme.typography.labelSmall,
                    color = cs.outline,
                )
            }
        }
    }
}

// ─── Results header (count + range) ─────────────────────────────────────────

@Composable
private fun ResultsHeader(state: CallsUiState, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val start = if (state.total == 0) 0 else (state.page - 1) * state.pageSize + 1
    val end = minOf(state.page * state.pageSize, state.total)
    val text = if (state.total == 0)
        "No matching calls"
    else
        "Showing $start–$end of ${state.total.toLocaleString()}"
    Text(
        text,
        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
        color = cs.onSurfaceVariant,
        modifier = modifier,
    )
}

// ─── Pending status strip ───────────────────────────────────────────────────

@Composable
private fun PendingStatusStrip(pendingUploads: Int, pendingSync: Int) {
    if (pendingUploads == 0 && pendingSync == 0) return
    val cs = MaterialTheme.colorScheme
    Surface(
        color = cs.secondaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(
                strokeWidth = 2.dp,
                color = cs.onSecondaryContainer,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(10.dp))
            val text = buildString {
                if (pendingSync > 0) {
                    append("Syncing $pendingSync call")
                    if (pendingSync != 1) append("s")
                }
                if (pendingUploads > 0) {
                    if (isNotEmpty()) append(" · ")
                    append("uploading $pendingUploads recording")
                    if (pendingUploads != 1) append("s")
                }
            }
            Text(
                text,
                color = cs.onSecondaryContainer,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

// ─── Call card ──────────────────────────────────────────────────────────────

@Composable
private fun CallLogCard(row: CallLogRowDto, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val (directionIcon, directionColor, directionLabel) = directionMeta(row)
    val name = row.lead?.name?.takeIf { it.isNotBlank() } ?: row.phoneNumber
    val initials = remember(name) {
        name.split(" ").filter { it.isNotBlank() }.take(2)
            .joinToString("") { it.first().uppercase() }.ifBlank { "?" }
    }
    val avatarBg = remember(name) {
        avatarPalette[(name.hashCode().let { if (it < 0) -it else it }) % avatarPalette.size]
    }

    Card(
        shape = RoundedCornerShape(18.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(contentAlignment = Alignment.BottomEnd) {
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(avatarBg),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        initials,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                    )
                }
                Box(
                    modifier = Modifier
                        .size(20.dp)
                        .clip(CircleShape)
                        .background(cs.surface)
                        .padding(2.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(CircleShape)
                            .background(directionColor),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            directionIcon,
                            contentDescription = directionLabel,
                            tint = Color.White,
                            modifier = Modifier.size(10.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (row.lead != null) name else "Unknown",
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = cs.onSurface,
                        maxLines = 1,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (row.hasRecording) {
                        Spacer(Modifier.width(8.dp))
                        RecordingBadge()
                    }
                }
                Text(
                    maskPhone(row.phoneNumber),
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                    maxLines = 1,
                )
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        formatDate(row.startedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.outline,
                    )
                    Text(
                        " · ",
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.outline,
                    )
                    StatusChip(status = row.status, durationSec = row.durationSec)
                }
                val sim = formatSim(row.simSlot, row.simCarrier, row.simNumber)
                if (sim != null) {
                    Spacer(Modifier.height(3.dp))
                    Text(
                        sim,
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.outline,
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusChip(status: String, durationSec: Int) {
    val cs = MaterialTheme.colorScheme
    val (color, label) = when (status.uppercase()) {
        "ANSWERED" -> ColorOutgoing to (if (durationSec > 0) formatDuration(durationSec) else "Answered")
        "MISSED" -> ColorMissed to "Missed"
        "NO_ANSWER" -> ColorMissed to "No answer"
        "REJECTED" -> ColorRejected to "Rejected"
        "BUSY" -> ColorRejected to "Busy"
        "FAILED" -> cs.error to "Failed"
        "RINGING" -> cs.primary to "Ringing"
        else -> cs.outline to status.lowercase().replaceFirstChar { it.uppercase() }
    }
    Surface(
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.15f),
    ) {
        Text(
            label,
            color = color,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun RecordingBadge() {
    val pulse by animateFloatAsState(
        targetValue = 1f,
        animationSpec = tween(durationMillis = 1500),
        label = "rec-pulse",
    )
    Surface(
        shape = RoundedCornerShape(50),
        color = ColorRecording.copy(alpha = 0.15f * pulse),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.GraphicEq,
                contentDescription = "Recording available",
                tint = ColorRecording,
                modifier = Modifier.size(12.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                "Rec",
                color = ColorRecording,
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            )
        }
    }
}

// ─── Pagination footer ──────────────────────────────────────────────────────

@Composable
private fun PaginationFooter(
    state: CallsUiState,
    onPageSize: (Int) -> Unit,
    onFirst: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onLast: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = cs.surface,
        shadowElevation = 0.5.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Page-size selector
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Per page",
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                )
                Spacer(Modifier.width(10.dp))
                PageSizeDropdown(current = state.pageSize, onSelect = onPageSize)
                Spacer(Modifier.weight(1f))
                Text(
                    "Page ${state.page} of ${state.totalPages.coerceAtLeast(1)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                )
            }
            // Nav buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                PagerButton(
                    icon = Icons.Outlined.KeyboardDoubleArrowLeft,
                    label = "First",
                    enabled = state.page > 1,
                    onClick = onFirst,
                    modifier = Modifier.weight(1f),
                )
                PagerButton(
                    icon = Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
                    label = "Prev",
                    enabled = state.page > 1,
                    onClick = onPrev,
                    modifier = Modifier.weight(1f),
                )
                PagerButton(
                    icon = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    label = "Next",
                    enabled = state.page < state.totalPages,
                    onClick = onNext,
                    modifier = Modifier.weight(1f),
                    trailing = true,
                )
                PagerButton(
                    icon = Icons.Outlined.KeyboardDoubleArrowRight,
                    label = "Last",
                    enabled = state.page < state.totalPages,
                    onClick = onLast,
                    modifier = Modifier.weight(1f),
                    trailing = true,
                )
            }
        }
    }
}

@Composable
private fun PageSizeDropdown(current: Int, onSelect: (Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val cs = MaterialTheme.colorScheme
    Box {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = cs.surfaceVariant,
            modifier = Modifier.clickable { expanded = true },
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    current.toString(),
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = cs.onSurfaceVariant,
                )
                Icon(
                    Icons.Outlined.ExpandMore,
                    contentDescription = null,
                    tint = cs.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            PAGE_SIZES.forEach { size ->
                DropdownMenuItem(
                    text = { Text("$size per page") },
                    onClick = {
                        onSelect(size)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun PagerButton(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: Boolean = false,
) {
    val cs = MaterialTheme.colorScheme
    val container = if (enabled) cs.surfaceVariant else cs.surfaceVariant.copy(alpha = 0.4f)
    val content = if (enabled) cs.onSurfaceVariant else cs.outline
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = container,
        modifier = modifier
            .height(40.dp)
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            if (!trailing) {
                Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(
                label,
                color = content,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            )
            if (trailing) {
                Spacer(Modifier.width(4.dp))
                Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(16.dp))
            }
        }
    }
}

// ─── Empty / error ─────────────────────────────────────────────────────────

@Composable
private fun EmptyCalls(state: CallsUiState, onRetry: () -> Unit, onReset: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val hasFilters = computeActiveFilterCount(state) > 0 || state.appliedQuery.isNotEmpty()
    Box(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(cs.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (state.error != null) Icons.Outlined.ErrorOutline else Icons.Outlined.Phone,
                    contentDescription = null,
                    tint = cs.onSurfaceVariant,
                    modifier = Modifier.size(36.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                when {
                    state.error != null -> "Couldn't load calls"
                    hasFilters -> "No calls match these filters"
                    else -> "No calls yet"
                },
                style = MaterialTheme.typography.titleMedium,
                color = cs.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                state.error
                    ?: if (hasFilters) "Try clearing the filters or widening the date range."
                    else "Calls + recordings sync here automatically.",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (hasFilters) {
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = cs.surfaceVariant,
                        modifier = Modifier.clickable(onClick = onReset),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Outlined.Restore,
                                contentDescription = null,
                                tint = cs.onSurfaceVariant,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                "Reset filters",
                                color = cs.onSurfaceVariant,
                                style = MaterialTheme.typography.labelLarge.copy(
                                    fontWeight = FontWeight.SemiBold,
                                ),
                            )
                        }
                    }
                }
                if (state.error != null) {
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = cs.primary,
                        modifier = Modifier.clickable(onClick = onRetry),
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Outlined.Sync,
                                contentDescription = null,
                                tint = cs.onPrimary,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                "Try again",
                                color = cs.onPrimary,
                                style = MaterialTheme.typography.labelLarge.copy(
                                    fontWeight = FontWeight.SemiBold,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorBanner(message: String, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = cs.errorContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.ErrorOutline,
                contentDescription = null,
                tint = cs.onErrorContainer,
            )
            Spacer(Modifier.width(10.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodySmall,
                color = cs.onErrorContainer,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

@Composable
private fun PermissionWarningBanner(modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = cs.errorContainer,
        modifier = modifier.fillMaxWidth().clickable {
            runCatching {
                val intent = android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = android.net.Uri.parse("package:${ctx.packageName}")
                }
                ctx.startActivity(intent)
            }
        },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.ErrorOutline,
                contentDescription = null,
                tint = cs.onErrorContainer,
            )
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Call tracking is inactive",
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                    color = cs.onErrorContainer,
                )
                Text(
                    "Tap to grant Call Log permissions so your activity can sync.",
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onErrorContainer,
                )
            }
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = cs.onErrorContainer,
            )
        }
    }
}

private val avatarPalette = listOf(
    Color(0xFF6366F1), Color(0xFF0EA5E9), Color(0xFF10B981),
    Color(0xFFF59E0B), Color(0xFFEF4444), Color(0xFF8B5CF6),
    Color(0xFFEC4899), Color(0xFF14B8A6),
)

private fun directionMeta(row: CallLogRowDto): Triple<ImageVector, Color, String> {
    val upper = row.direction.uppercase()
    val status = row.status.uppercase()
    return when {
        upper == "OUTGOING" && (status == "MISSED" || status == "NO_ANSWER") ->
            Triple(Icons.AutoMirrored.Outlined.CallMissed, ColorMissed, "Unanswered")
        upper == "OUTGOING" ->
            Triple(Icons.AutoMirrored.Outlined.CallMade, ColorOutgoing, "Outgoing")
        status == "MISSED" || status == "NO_ANSWER" ->
            Triple(Icons.AutoMirrored.Outlined.CallMissed, ColorMissed, "Missed")
        status == "REJECTED" || status == "BUSY" ->
            Triple(Icons.AutoMirrored.Outlined.CallMissed, ColorRejected, "Rejected")
        else ->
            Triple(Icons.AutoMirrored.Outlined.CallReceived, ColorIncoming, "Incoming")
    }
}

private val ISO = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
}
private val SAME_DAY_FMT = SimpleDateFormat("HH:mm", Locale.getDefault())
private val OTHER_DAY_FMT = SimpleDateFormat("d MMM, HH:mm", Locale.getDefault())
private val DATE_PARSE = SimpleDateFormat("yyyy-MM-dd", Locale.US)

private fun formatDate(iso: String): String = runCatching {
    val parsed = ISO.parse(iso.substring(0, 19))!!
    val now = Calendar.getInstance()
    val cal = Calendar.getInstance().apply { time = parsed }
    val sameDay = now.get(Calendar.YEAR) == cal.get(Calendar.YEAR) &&
        now.get(Calendar.DAY_OF_YEAR) == cal.get(Calendar.DAY_OF_YEAR)
    if (sameDay) "Today, ${SAME_DAY_FMT.format(parsed)}" else OTHER_DAY_FMT.format(parsed)
}.getOrDefault(iso)

private fun formatDuration(sec: Int): String {
    if (sec <= 0) return "0s"
    val m = sec / 60
    val s = sec % 60
    return if (m > 0) "${m}m ${s}s" else "${s}s"
}

private fun formatHM(sec: Int): String {
    if (sec <= 0) return "0m"
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return when {
        h > 0 -> "${h}h ${m}m"
        m > 0 -> "${m}m ${s}s"
        else -> "${s}s"
    }
}

private fun formatSim(slot: Int?, carrier: String?, number: String?): String? {
    if (!number.isNullOrBlank()) {
        return if (!carrier.isNullOrBlank()) "via $number · $carrier" else "via $number"
    }
    val parts = listOfNotNull(
        slot?.let { "SIM $it" },
        carrier?.takeIf { it.isNotBlank() },
    )
    return parts.takeIf { it.isNotEmpty() }?.let { "via ${it.joinToString(" · ")}" }
}

internal fun parseDateMillis(s: String): Long? =
    runCatching { DATE_PARSE.parse(s)?.time }.getOrNull()

internal fun formatDateMillis(ms: Long): String =
    DATE_PARSE.format(java.util.Date(ms))

private fun connectRate(s: CallLogSummaryDto): Int? {
    if (s.total <= 0) return null
    return ((s.answered.toDouble() / s.total) * 100).toInt()
}

// toLocaleString() now lives in util/CountFormat.kt (was duplicated here and in
// LeadListScreen).
