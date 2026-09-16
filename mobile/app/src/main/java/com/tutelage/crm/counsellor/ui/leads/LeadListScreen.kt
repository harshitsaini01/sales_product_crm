@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.leads

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowRight
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import com.tutelage.crm.counsellor.data.leads.LeadListRowDto
import com.tutelage.crm.counsellor.util.maskPhone
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val HeaderGradient: Brush = Brush.linearGradient(
    colors = listOf(
        Color(0xFF0B1029),
        Color(0xFF312E81),
        Color(0xFF6D28D9),
    ),
)

@Composable
fun LeadListScreen(
    vm: LeadListViewModel = hiltViewModel(),
    onLeadClick: (Long) -> Unit,
    onLogout: () -> Unit,
    onBack: (() -> Unit)? = null,
    taskIds: List<Long> = emptyList(),
    taskTitle: String? = null,
    /** Calling task this list is scoped to; 0 when browsing normally. */
    taskBatchId: Long = 0L,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val update by vm.updateAvailable.collectAsStateWithLifecycle()
    val cs = MaterialTheme.colorScheme
    // Task item awaiting a reason, or null when the picker is closed.
    var markingReasonFor by remember { mutableStateOf<Long?>(null) }

    LaunchedEffect(Unit) { vm.start(taskIds, taskTitle, taskBatchId) }

    markingReasonFor?.let { itemId ->
        MarkDoneReasonDialog(
            onPick = { reason -> markingReasonFor = null; vm.markTaskItemDone(itemId, reason) },
            onDismiss = { markingReasonFor = null },
        )
    }

    Scaffold(containerColor = cs.background) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item(key = "__header__") {
                LeadsHeader(
                    title = state.taskTitle ?: state.userName ?: "My Leads",
                    total = state.total,
                    pageSize = state.pageSize,
                    refreshing = state.refreshing,
                    lastSyncedAtMs = null,
                    onRefresh = vm::pullToRefresh,
                    onLogout = { vm.logout(onLogout) },
                    onBack = onBack,
                )
            }

            update?.let { ua ->
                item(key = "__update__") {
                    Surface(
                        color = cs.tertiaryContainer,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                "Update available — v${ua.release.versionName}" + if (ua.isMandatory) " (required)" else "",
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = cs.onTertiaryContainer,
                            )
                            ua.release.releaseNotes?.takeIf { it.isNotBlank() }?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = cs.onTertiaryContainer,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                            }
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(top = 10.dp),
                            ) {
                                Button(
                                    onClick = { vm.installUpdate(ua.release) },
                                    shape = RoundedCornerShape(10.dp),
                                ) { Text("Install") }
                                if (!ua.isMandatory) {
                                    TextButton(onClick = vm::dismissUpdate) { Text("Later") }
                                }
                            }
                        }
                    }
                }
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
                    state = state,
                    onStatus = vm::setStatus,
                    onSubStatus = vm::setSubStatus,
                    onCalled = vm::setCalled,
                    onFromDate = vm::setFromDate,
                    onToDate = vm::setToDate,
                    onExcludeMode = vm::setExcludeMode,
                    onReset = vm::clearFilters,
                )
            }

            // Exclude is a MODE, and its control lives inside the collapsible
            // panel above. Without a banner out here, collapsing the panel left
            // nothing on screen explaining why the list was inverted — exactly
            // the confusion this had on the web. So it stays visible whenever
            // the mode is on, panel open or shut.
            item(key = "__exclude_banner__") {
                ExcludeBanner(
                    visible = state.excludeMode,
                    filterCount = computeExcludableFilterCount(state),
                    onTurnOff = { vm.setExcludeMode(false) },
                )
            }

            item(key = "__followup_chips__") {
                FollowupChips(
                    active = state.followupFilter,
                    onSelect = vm::setFollowupFilter,
                )
            }

            // Subtle progress bar during silent refresh
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

            if (!(state.loading && state.rows.isEmpty())) {
                item(key = "__count__") {
                    ResultsHeader(
                        state = state,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    )
                }
                // Mirror the bottom pager up top so the user doesn't have to
                // scroll a 500-lead page to flip to the next page or change
                // page-size. Same actions, slimmer (single-row) layout.
                if (state.rows.isNotEmpty()) {
                    item(key = "__pager_top__") {
                        PaginationToolbar(
                            state = state,
                            onPageSize = vm::setPageSize,
                            onFirst = vm::firstPage,
                            onPrev = vm::prevPage,
                            onNext = vm::nextPage,
                            onLast = vm::lastPage,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                        )
                    }
                }
            }

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
                        EmptyLeads(
                            state = state,
                            onRetry = vm::pullToRefresh,
                            onReset = vm::clearFilters,
                        )
                    }
                }
                else -> {
                    state.error?.let { msg ->
                        item(key = "__error__") {
                            ErrorBanner(msg, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                        }
                    }
                    state.markMessage?.let { msg ->
                        item(key = "__markmsg__") {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = cs.secondaryContainer,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 6.dp)
                                    .clickable { vm.clearMarkMessage() },
                            ) {
                                Text(
                                    msg,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = cs.onSecondaryContainer,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                )
                            }
                        }
                    }
                    // Inside a calling task the server returns still-to-call
                    // first and already-called after. Name both halves so the
                    // split is obvious — a done lead stays visible instead of
                    // vanishing, and it is clear WHY it moved down the list.
                    val inTask = state.taskBatchId > 0L
                    val firstDoneId = if (inTask) state.rows.firstOrNull { it.taskDone }?.id else null
                    val pendingCount = if (inTask) state.rows.count { !it.taskDone } else 0
                    val doneCount = if (inTask) state.rows.count { it.taskDone } else 0
                    if (inTask && pendingCount > 0) {
                        item(key = "__task_pending_hdr__") {
                            TaskSplitHeading("Still to call · $pendingCount", Color(0xFFB45309))
                        }
                    }
                    items(items = state.rows, key = { it.id }) { lead ->
                        if (lead.id == firstDoneId) {
                            TaskSplitHeading("Already called · $doneCount", Color(0xFF059669))
                        }
                        LeadCard(
                            lead = lead,
                            onClick = { onLeadClick(lead.id) },
                            // Escape hatch, only inside a task and only while
                            // the item is still open: some leads can never be
                            // cleared by a call (no number, wrong number,
                            // reached on WhatsApp) and used to pin a task at
                            // "1 call left" forever.
                            onMarkDone = if (inTask && !lead.taskDone && lead.taskItemId != null) {
                                { markingReasonFor = lead.taskItemId }
                            } else null,
                            // Only a manual mark can be undone — a completion a
                            // real call produced would just be re-derived.
                            onUndoDone = if (inTask && lead.taskDone && lead.taskItemId != null &&
                                lead.taskCompletionType?.startsWith("MANUAL_") == true
                            ) {
                                { vm.undoTaskItemDone(lead.taskItemId) }
                            } else null,
                            marking = state.markingItemId != null && state.markingItemId == lead.taskItemId,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                }
            }

            if (state.rows.isNotEmpty()) {
                item(key = "__pager__") {
                    PaginationFooter(
                        state = state,
                        onPageSize = vm::setPageSize,
                        onFirst = vm::firstPage,
                        onPrev = vm::prevPage,
                        onNext = vm::nextPage,
                        onLast = vm::lastPage,
                        onGoToPage = vm::goToPage,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
}

// ─── Header ────────────────────────────────────────────────────────────────

@Composable
private fun LeadsHeader(
    title: String,
    total: Int,
    pageSize: Int,
    refreshing: Boolean,
    lastSyncedAtMs: Long?,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    onBack: (() -> Unit)? = null,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(HeaderGradient)
            .padding(horizontal = 20.dp, vertical = 18.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onBack != null) {
                    IconButtonCircle(
                        icon = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        onClick = onBack,
                    )
                    Spacer(Modifier.width(10.dp))
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        color = Color.White,
                        maxLines = 2,
                    )
                    LiveSubtitle(refreshing = refreshing, lastSyncedAtMs = lastSyncedAtMs)
                }
                IconButtonCircle(
                    icon = Icons.Default.Refresh,
                    contentDescription = "Refresh",
                    enabled = !refreshing,
                    onClick = onRefresh,
                    loading = refreshing,
                )
                if (onBack == null) {
                    Spacer(Modifier.width(8.dp))
                    IconButtonCircle(
                        icon = Icons.AutoMirrored.Outlined.Logout,
                        contentDescription = "Logout",
                        onClick = onLogout,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            // Stat tiles in the header — total + page size + pages overview.
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HeaderStat(
                    modifier = Modifier.weight(1f),
                    value = total.toLocaleString(),
                    label = "Total leads",
                )
                HeaderStat(
                    modifier = Modifier.weight(1f),
                    value = pageSize.toString(),
                    label = "Per page",
                )
                HeaderStat(
                    modifier = Modifier.weight(1f),
                    value = totalPagesFor(total, pageSize).toString(),
                    label = "Pages",
                )
            }
        }
    }
}

@Composable
private fun IconButtonCircle(
    icon: ImageVector,
    contentDescription: String,
    enabled: Boolean = true,
    loading: Boolean = false,
    onClick: () -> Unit,
) {
    Surface(
        shape = CircleShape,
        color = Color.White.copy(alpha = 0.18f),
        modifier = Modifier
            .size(40.dp)
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
            if (loading) {
                CircularProgressIndicator(
                    color = Color.White,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(18.dp),
                )
            } else {
                Icon(
                    icon,
                    contentDescription = contentDescription,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
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
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = Color.White.copy(alpha = 0.12f),
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.Start,
        ) {
            StatValue(
                text = value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = Color.White,
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
        refreshing -> "Syncing…"
        lastSyncedAtMs == null -> "Your assigned leads"
        else -> {
            val ago = ((nowMs - lastSyncedAtMs) / 1000L).coerceAtLeast(0)
            val agoText = when {
                ago < 60 -> "just now"
                ago < 3600 -> "${ago / 60}m ago"
                else -> "${ago / 3600}h ago"
            }
            "Live · synced $agoText"
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(Color(0xFF34D399)),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.85f),
        )
    }
}

// ─── Search + filter toggle ────────────────────────────────────────────────

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
            placeholder = { Text("Search name, phone, email, city…", style = MaterialTheme.typography.bodyMedium) },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            trailingIcon = {
                if (searchInput.isNotEmpty()) {
                    Icon(
                        Icons.Outlined.Clear,
                        contentDescription = "Clear",
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
                            color = cs.onPrimary,
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

private fun computeActiveFilterCount(s: LeadListUiState): Int {
    var n = 0
    if (s.status.isNotEmpty()) n++
    if (s.subStatus.isNotEmpty()) n++
    if (s.followupFilter != FollowupFilter.NONE) n++
    if (s.called.isNotEmpty()) n++
    if (s.fromDate.isNotEmpty()) n++
    if (s.toDate.isNotEmpty()) n++
    return n
}

/** How many filters Exclude mode would actually invert.
 *
 *  The search box counts here but not in [computeActiveFilterCount] — it has
 *  its own field above the panel, so it is never part of the panel's badge,
 *  but the server does negate it. The Calling-Task id scope is excluded on
 *  purpose: it is never inverted, by the UI or the server. */
private fun computeExcludableFilterCount(s: LeadListUiState): Int =
    computeActiveFilterCount(s) + if (s.appliedQuery.isNotBlank()) 1 else 0

// ─── Match mode (Include / Exclude) ────────────────────────────────────────

/**
 * Segmented Include/Exclude control — the mobile twin of the web's
 * FilterModeToggle, and it means exactly the same thing:
 *
 *   Include  results match EVERY filter set below.
 *   Exclude  results match NONE of them — each filter negated on its own,
 *            so "status=Hot + source=FB" excluded means neither Hot nor FB,
 *            not "everything but leads that are both".
 *
 * The negation itself happens server-side in /api/mobile/leads/list, which
 * negates NULL-safely: a lead with no sub-status recorded does not match
 * "sub-status = Interested", so excluding that sub-status keeps it.
 */
@Composable
private fun MatchModeToggle(excludeMode: Boolean, onChange: (Boolean) -> Unit) {
    val cs = MaterialTheme.colorScheme
    Column {
        Text(
            "Match mode",
            style = MaterialTheme.typography.labelSmall,
            color = cs.outline,
        )
        Spacer(Modifier.height(6.dp))
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = cs.surfaceVariant,
            border = BorderStroke(1.dp, cs.outlineVariant),
        ) {
            Row(modifier = Modifier.padding(3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                MatchModeSegment(
                    label = "Include",
                    icon = Icons.Outlined.CheckCircle,
                    selected = !excludeMode,
                    selectedColor = cs.primary,
                    onSelectedColor = cs.onPrimary,
                    modifier = Modifier.weight(1f),
                ) { onChange(false) }
                MatchModeSegment(
                    label = "Exclude",
                    icon = Icons.Outlined.Block,
                    selected = excludeMode,
                    selectedColor = cs.error,
                    onSelectedColor = cs.onError,
                    modifier = Modifier.weight(1f),
                ) { onChange(true) }
            }
        }
    }
}

@Composable
private fun MatchModeSegment(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    selectedColor: Color,
    onSelectedColor: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = if (selected) selectedColor else Color.Transparent,
        modifier = modifier.clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = if (selected) onSelectedColor else cs.onSurfaceVariant,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                color = if (selected) onSelectedColor else cs.onSurfaceVariant,
            )
        }
    }
}

/**
 * Always-on-screen reminder that the list is inverted, with a one-tap way out.
 *
 * When no filter is set there is nothing to negate, so it says so rather than
 * implying the list has been narrowed — the server is deliberately not sent
 * `excludeMode` in that case, and the banner must not disagree with it.
 */
@Composable
private fun ExcludeBanner(visible: Boolean, filterCount: Int, onTurnOff: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    AnimatedVisibility(
        visible = visible,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = cs.errorContainer,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.Block,
                    contentDescription = null,
                    tint = cs.onErrorContainer,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = when {
                        filterCount == 0 -> "Exclude is on — no filter set for it to invert"
                        filterCount == 1 -> "Excluding this filter — showing leads that do NOT match it"
                        else -> "Excluding these $filterCount filters — showing leads that match none of them"
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onErrorContainer,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = cs.onErrorContainer.copy(alpha = 0.12f),
                    modifier = Modifier.clickable(onClick = onTurnOff),
                ) {
                    Text(
                        "Include",
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = cs.onErrorContainer,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                    )
                }
            }
        }
    }
}

// ─── Filters panel ─────────────────────────────────────────────────────────

@Composable
private fun FiltersPanel(
    visible: Boolean,
    state: LeadListUiState,
    onStatus: (String) -> Unit,
    onSubStatus: (String) -> Unit,
    onCalled: (String) -> Unit,
    onFromDate: (String) -> Unit,
    onToDate: (String) -> Unit,
    onExcludeMode: (Boolean) -> Unit,
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
                MatchModeToggle(excludeMode = state.excludeMode, onChange = onExcludeMode)

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(modifier = Modifier.weight(1f)) {
                        StatusDropdown(
                            label = "Status",
                            options = listOf("" to "All statuses") + state.statusOptions.map { it.value to "${it.value} (${it.count})" },
                            selectedValue = state.status,
                            onSelect = onStatus,
                        )
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        // Sub-status options narrow to the current parent if one is set.
                        val subOptions = remember(state.status, state.subStatusOptions) {
                            val filtered = if (state.status.isNotEmpty())
                                state.subStatusOptions.filter { it.parentStatus == state.status }
                            else state.subStatusOptions
                            listOf("" to "All sub-statuses") + filtered.map { it.value to "${it.value} (${it.count})" }
                        }
                        StatusDropdown(
                            label = "Sub-status",
                            options = subOptions,
                            selectedValue = state.subStatus,
                            onSelect = onSubStatus,
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(modifier = Modifier.weight(1f)) {
                        DateField(label = "Created from", value = state.fromDate, onChange = onFromDate)
                    }
                    Box(modifier = Modifier.weight(1f)) {
                        DateField(label = "Created to", value = state.toDate, onChange = onToDate)
                    }
                }

                // Called toggle — all / called / not called. Commented out,
                // not in use.
                /*
                Column {
                    Text(
                        "Call status",
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.outline,
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("" to "All", "1" to "Called", "0" to "Not called").forEach { (v, label) ->
                            FilterChipLike(
                                label = label,
                                selected = state.called == v,
                                onClick = { onCalled(v) },
                            )
                        }
                    }
                }
                */

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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
                                "Reset all filters",
                                color = cs.onSurfaceVariant,
                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusDropdown(
    label: String,
    options: List<Pair<String, String>>,
    selectedValue: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.first == selectedValue }?.second
        ?: options.firstOrNull()?.second ?: ""
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
            options.forEach { (value, lbl) ->
                DropdownMenuItem(
                    text = { Text(lbl) },
                    onClick = {
                        onSelect(value)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun DateField(label: String, value: String, onChange: (String) -> Unit) {
    // A readOnly OutlinedTextField swallows its own touch input even with a
    // .clickable modifier stacked on top, so tapping it to open the picker
    // was unreliable. A plain clickable Surface (same trick as DropdownField
    // elsewhere in this app) always registers the tap.
    var showPicker by remember { mutableStateOf(false) }
    val cs = MaterialTheme.colorScheme

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = cs.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, bottom = 4.dp),
        )
        Surface(
            onClick = { showPicker = true },
            shape = RoundedCornerShape(12.dp),
            color = cs.surface,
            border = BorderStroke(1.dp, cs.outline.copy(alpha = 0.5f)),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.DateRange,
                    contentDescription = null,
                    tint = cs.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    value.ifEmpty { "Not set" },
                    modifier = Modifier.weight(1f),
                    color = if (value.isNotEmpty()) cs.onSurface else cs.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (value.isNotEmpty()) {
                    IconButton(onClick = { onChange("") }, modifier = Modifier.size(28.dp)) {
                        Icon(
                            Icons.Outlined.Clear,
                            contentDescription = "Clear",
                            tint = cs.onSurfaceVariant,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
        }
    }

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

@Composable
private fun FilterChipLike(label: String, selected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (selected) cs.primary else cs.surfaceVariant,
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Text(
            label,
            color = if (selected) cs.onPrimary else cs.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium.copy(
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            ),
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

// ─── Followup chips ────────────────────────────────────────────────────────

@Composable
private fun FollowupChips(active: FollowupFilter, onSelect: (FollowupFilter) -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FollowupFilter.values().forEach { f ->
            val selected = active == f
            Surface(
                shape = RoundedCornerShape(50),
                color = if (selected) cs.primary else cs.surfaceVariant,
                modifier = Modifier.clickable { onSelect(f) },
            ) {
                Text(
                    f.label,
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

// ─── Results header ────────────────────────────────────────────────────────

@Composable
private fun ResultsHeader(state: LeadListUiState, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val start = if (state.total == 0) 0 else (state.page - 1) * state.pageSize + 1
    val end = minOf(state.page * state.pageSize, state.total)
    val onPage = state.rows.size
    val text = if (state.total == 0)
        "No matching leads"
    else
        "Showing $start–$end of ${state.total.toLocaleString()} · $onPage on this page"
    Text(
        text,
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
        color = cs.onSurface.copy(alpha = 0.72f),
        modifier = modifier,
    )
}

/** Section label splitting a task-scoped list into to-call / already-called. */
@Composable
private fun TaskSplitHeading(text: String, tone: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
        color = tone,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 2.dp),
    )
}

// ─── Lead card ─────────────────────────────────────────────────────────────

/** Reasons a counsellor can clear a task item by hand. Keys mirror the
 *  server's MANUAL_REASONS map in lead-work.routes.ts. */
private val MARK_DONE_REASONS = listOf(
    "answered" to "Answered — talked",
    "no_answer" to "No answer",
    "busy" to "Busy",
    "switched_off" to "Switched off",
    "wrong_number" to "Wrong number",
    "dnd" to "DND / do not disturb",
    "other" to "Other reason",
)

@Composable
private fun MarkDoneReasonDialog(onPick: (String) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Mark this lead done") },
        text = {
            Column {
                Text(
                    "This writes a call log for the lead — it shows on the lead page and in reports.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                MARK_DONE_REASONS.forEach { (key, label) ->
                    TextButton(
                        onClick = { onPick(key) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(label, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun LeadCard(
    lead: LeadListRowDto,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    /** Non-null only inside a calling task, on an item still open. */
    onMarkDone: (() -> Unit)? = null,
    /** Non-null only on an item cleared BY HAND inside a calling task. */
    onUndoDone: (() -> Unit)? = null,
    marking: Boolean = false,
) {
    val cs = MaterialTheme.colorScheme
    // Three card tones, in priority order:
    //   • already done inside the calling task being viewed — deeper green,
    //     and it STAYS in the list rather than disappearing once called;
    //   • on one of today's calling tasks — light green, so today's work is
    //     obvious while scrolling the ordinary Leads tab;
    //   • everything else — the normal surface.
    val container = when {
        lead.taskDone -> Color(0xFFD1FAE5)
        lead.inTodayTask -> Color(0xFFECFDF5)
        else -> cs.surface
    }
    Card(
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        colors = CardDefaults.cardColors(containerColor = container),
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.Top,
        ) {
            AvatarCircle(name = lead.name)
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        lead.name?.takeIf { it.isNotBlank() } ?: "(unnamed)",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        maxLines = 1,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    // Done marker, right behind the name — this lead's item in
                    // the task being viewed has been worked.
                    if (lead.taskDone) {
                        Spacer(Modifier.width(6.dp))
                        Surface(shape = RoundedCornerShape(999.dp), color = Color(0xFF059669)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            ) {
                                Icon(
                                    Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(10.dp),
                                )
                                Spacer(Modifier.width(3.dp))
                                Text(
                                    "DONE",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                    color = Color.White,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                    if ((lead.flagSend ?: 0) == 1 || (lead.flagRcv ?: 0) == 1) {
                        Spacer(Modifier.width(6.dp))
                        Icon(
                            Icons.Outlined.Flag,
                            contentDescription = "Flagged",
                            tint = Color(0xFFEF4444),
                            modifier = Modifier.size(14.dp),
                        )
                    }
                    if ((lead.called ?: 0) == 1) {
                        Spacer(Modifier.width(6.dp))
                        Icon(
                            Icons.Outlined.Phone,
                            contentDescription = "Called",
                            tint = Color(0xFF10B981),
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
                Text(
                    maskPhone(lead.mobile),
                    style = MaterialTheme.typography.bodyMedium,
                    color = cs.onSurfaceVariant,
                    maxLines = 1,
                )

                // Status + sub-status chips — the headline info a counsellor
                // scans for first when triaging a list of leads.
                if (!lead.leadStatus.isNullOrBlank() || !lead.leadSubStatus.isNullOrBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        lead.leadStatus?.takeIf { it.isNotBlank() }?.let { StatusChip(it) }
                        lead.leadSubStatus?.takeIf { it.isNotBlank() }?.let { SubStatusChip(it) }
                    }
                }

                // Location / source / interested course — small icon + label
                // rows so each fact is scannable at a glance.
                val metaRows = listOfNotNull(
                    lead.city?.takeIf { it.isNotBlank() }?.let { Icons.Outlined.Place to it },
                    lead.intrestedCourse?.takeIf { it.isNotBlank() }?.let { Icons.Outlined.School to it },
                    lead.source?.takeIf { it.isNotBlank() }?.let { Icons.Outlined.Campaign to it },
                )
                if (metaRows.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        metaRows.forEach { (icon, label) ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    icon,
                                    contentDescription = null,
                                    tint = cs.onSurfaceVariant,
                                    modifier = Modifier.size(13.dp),
                                )
                                Spacer(Modifier.width(5.dp))
                                Text(
                                    label,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = cs.onSurfaceVariant,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }

                // When the number was actually last rung — date AND time. The
                // question a counsellor is answering is "have I already tried
                // this one today?", which a relative "3h ago" does not settle.
                val lastCall = lead.lastCallAt?.let { formatCallStamp(it) }
                if (lastCall != null) {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Outlined.Phone,
                            contentDescription = null,
                            tint = Color(0xFF059669),
                            modifier = Modifier.size(13.dp),
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            "Last call: $lastCall" +
                                if (lead.callAttempts > 1) " · ${lead.callAttempts} attempts" else "",
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                            color = cs.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                }

                val followupText = lead.followupDate?.let { formatFollowupDate(it) }
                if (followupText != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Followup: $followupText",
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = followupColor(lead.followupDate),
                    )
                }

                if (onUndoDone != null) {
                    Spacer(Modifier.height(8.dp))
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = Color(0xFFFEF3C7),
                        modifier = Modifier.clickable(enabled = !marking, onClick = onUndoDone),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        ) {
                            if (marking) {
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    color = Color(0xFF92400E),
                                    modifier = Modifier.size(13.dp),
                                )
                            } else {
                                Icon(
                                    Icons.Outlined.Restore,
                                    contentDescription = null,
                                    tint = Color(0xFF92400E),
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                            Spacer(Modifier.width(6.dp))
                            Text(
                                if (marking) "Undoing…" else "Marked by hand · undo",
                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                                color = Color(0xFF92400E),
                            )
                        }
                    }
                }

                if (onMarkDone != null) {
                    Spacer(Modifier.height(8.dp))
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = Color(0xFFECFDF5),
                        modifier = Modifier.clickable(enabled = !marking, onClick = onMarkDone),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        ) {
                            if (marking) {
                                CircularProgressIndicator(
                                    strokeWidth = 2.dp,
                                    color = Color(0xFF047857),
                                    modifier = Modifier.size(13.dp),
                                )
                            } else {
                                Icon(
                                    Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = Color(0xFF047857),
                                    modifier = Modifier.size(14.dp),
                                )
                            }
                            Spacer(Modifier.width(6.dp))
                            Text(
                                if (marking) "Marking…" else "Mark done",
                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                                color = Color(0xFF047857),
                            )
                        }
                    }
                }
            }
        }
    }
}

// Soft pastel bubble — light tinted background + a matching darker tone for
// the initials, instead of a bold solid fill + white text. Reads as gentle
// and friendly rather than a stark, saturated badge.
private val SOFT_AVATAR_PALETTE = listOf(
    Color(0xFFE0E7FF) to Color(0xFF4F46E5), // indigo
    Color(0xFFE0F2FE) to Color(0xFF0284C7), // sky
    Color(0xFFD1FAE5) to Color(0xFF059669), // emerald
    Color(0xFFFEF3C7) to Color(0xFFB45309), // amber
    Color(0xFFFCE7F3) to Color(0xFFBE185D), // pink
    Color(0xFFEDE9FE) to Color(0xFF7C3AED), // violet
    Color(0xFFCCFBF1) to Color(0xFF0F766E), // teal
    Color(0xFFFFE4E6) to Color(0xFFBE123C), // rose
)

@Composable
internal fun AvatarCircle(name: String?, size: Int = 44) {
    // Both derived values are keyed on the name: without remember every card in
    // a 50-row list re-split the string and re-hashed it on each recomposition,
    // and the list recomposes on every poll.
    val initials = remember(name) {
        (name ?: "?").split(" ")
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }
            .ifBlank { "?" }
    }
    val (bg, fg) = remember(name) {
        SOFT_AVATAR_PALETTE[
            (name?.hashCode() ?: 0).let { if (it < 0) -it else it } % SOFT_AVATAR_PALETTE.size
        ]
    }
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size * 0.32f).dp))
            .background(bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials,
            color = fg,
            fontWeight = FontWeight.Bold,
            fontSize = (size * 0.34).sp,
        )
    }
}

@Composable
private fun StatusChip(status: String) {
    val cs = MaterialTheme.colorScheme
    val (bg, fg) = when (status.lowercase()) {
        "hot", "interested", "qualified", "enrolled", "confirm", "confirmed" ->
            Color(0xFFD1FAE5) to Color(0xFF065F46)
        "warm", "follow-up", "followup", "callback" ->
            Color(0xFFFEF3C7) to Color(0xFF92400E)
        "cold", "not interested", "lost", "junk", "dnp" ->
            Color(0xFFFEE2E2) to Color(0xFF991B1B)
        else -> cs.primaryContainer to cs.onPrimaryContainer
    }
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Text(
            status,
            color = fg,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun SubStatusChip(subStatus: String) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = Color.Transparent,
        border = BorderStroke(1.dp, cs.outline.copy(alpha = 0.6f)),
    ) {
        Text(
            subStatus,
            color = cs.onSurfaceVariant,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

// ─── Pagination footer ─────────────────────────────────────────────────────

/**
 * Slim single-row pager that sits ABOVE the cards. Same controls as
 * [PaginationFooter] but compressed — page-size selector + Prev/Next +
 * "Page X of Y" all in one row.
 */
@Composable
private fun PaginationToolbar(
    state: LeadListUiState,
    onPageSize: (Int) -> Unit,
    onFirst: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onLast: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = cs.surface,
        shadowElevation = 0.5.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            PageSizeDropdown(current = state.pageSize, onSelect = onPageSize)
            Spacer(Modifier.weight(1f))
            CompactPagerButton(
                icon = Icons.Outlined.KeyboardDoubleArrowLeft,
                enabled = state.page > 1,
                onClick = onFirst,
                contentDescription = "First page",
            )
            CompactPagerButton(
                icon = Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
                enabled = state.page > 1,
                onClick = onPrev,
                contentDescription = "Previous page",
            )
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = cs.primaryContainer,
                modifier = Modifier.padding(horizontal = 2.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                ) {
                    Text(
                        "${state.page}",
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                        color = cs.onPrimaryContainer,
                    )
                    Text(
                        " of ${state.totalPages.coerceAtLeast(1)}",
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
                        color = cs.onPrimaryContainer.copy(alpha = 0.75f),
                    )
                }
            }
            CompactPagerButton(
                icon = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                enabled = state.page < state.totalPages,
                onClick = onNext,
                contentDescription = "Next page",
            )
            CompactPagerButton(
                icon = Icons.Outlined.KeyboardDoubleArrowRight,
                enabled = state.page < state.totalPages,
                onClick = onLast,
                contentDescription = "Last page",
            )
        }
    }
}

@Composable
private fun CompactPagerButton(
    icon: ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
    contentDescription: String,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = if (enabled) cs.surfaceVariant else cs.surfaceVariant.copy(alpha = 0.4f),
        modifier = Modifier
            .size(34.dp)
            .clickable(enabled = enabled, onClick = onClick),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
            Icon(
                icon,
                contentDescription = contentDescription,
                tint = if (enabled) cs.onSurfaceVariant else cs.outline,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun PaginationFooter(
    state: LeadListUiState,
    onPageSize: (Int) -> Unit,
    onFirst: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onLast: () -> Unit,
    onGoToPage: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    var goToInput by remember { mutableStateOf("") }

    Surface(
        shape = RoundedCornerShape(14.dp),
        color = cs.surface,
        shadowElevation = 0.5.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
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
            // Go-to-page row — only useful when there are multiple pages
            if (state.totalPages > 1) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "Go to page",
                        style = MaterialTheme.typography.labelMedium,
                        color = cs.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = goToInput,
                        onValueChange = { v -> if (v.length <= 4 && v.all { it.isDigit() }) goToInput = v },
                        placeholder = { Text("1–${state.totalPages}", style = MaterialTheme.typography.labelMedium) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Go,
                        ),
                        keyboardActions = KeyboardActions(onGo = {
                            val p = goToInput.toIntOrNull()
                            if (p != null) { onGoToPage(p); goToInput = "" }
                        }),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.width(80.dp),
                    )
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (goToInput.isNotEmpty()) cs.primary else cs.surfaceVariant,
                        modifier = Modifier
                            .height(40.dp)
                            .clickable(enabled = goToInput.isNotEmpty()) {
                                val p = goToInput.toIntOrNull()
                                if (p != null) { onGoToPage(p); goToInput = "" }
                            },
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 16.dp)) {
                            Text(
                                "Go",
                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                                color = if (goToInput.isNotEmpty()) cs.onPrimary else cs.onSurfaceVariant,
                            )
                        }
                    }
                }
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
            LEAD_PAGE_SIZES.forEach { size ->
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
        border = if (enabled) null else BorderStroke(0.5.dp, cs.outline.copy(alpha = 0.3f)),
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
private fun EmptyLeads(state: LeadListUiState, onRetry: () -> Unit, onReset: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val hasFilters = computeActiveFilterCount(state) > 0 || state.appliedQuery.isNotEmpty() || state.excludeMode
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
                    if (state.error != null) Icons.Outlined.ErrorOutline else Icons.Outlined.Inbox,
                    contentDescription = null,
                    tint = cs.onSurfaceVariant,
                    modifier = Modifier.size(36.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                when {
                    state.error != null -> "Couldn't load leads"
                    hasFilters -> "No leads match these filters"
                    else -> "No leads assigned yet"
                },
                style = MaterialTheme.typography.titleMedium,
                color = cs.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                state.error
                    ?: if (hasFilters) "Try clearing the filters or widening the date range."
                    else "Your assigned leads will appear here.",
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
                                Icons.Outlined.Cancel,
                                contentDescription = null,
                                tint = cs.onSurfaceVariant,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                "Reset filters",
                                color = cs.onSurfaceVariant,
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
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
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
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

// ─── Helpers ───────────────────────────────────────────────────────────────

// Material3's DatePicker reports selectedDateMillis in UTC (midnight UTC for
// the picked day), so this formatter must parse/format in UTC too — otherwise
// the stored "yyyy-MM-dd" can land on the wrong day depending on the device's
// timezone offset.
private val ISO_DATE = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
}
private val FOLLOWUP_PARSE_LIST = listOf(
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") },
    SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US),
    SimpleDateFormat("yyyy-MM-dd", Locale.US),
)
private val FOLLOWUP_OUT = SimpleDateFormat("d MMM, HH:mm", Locale.getDefault())
private val FOLLOWUP_OUT_DATE = SimpleDateFormat("d MMM yyyy", Locale.getDefault())

private fun parseFollowup(iso: String): Date? {
    for (fmt in FOLLOWUP_PARSE_LIST) {
        runCatching { return fmt.parse(iso) }
    }
    return null
}

private val CALL_STAMP_OUT = java.time.format.DateTimeFormatter.ofPattern("d MMM, h:mm a", Locale.getDefault())

/** "22 Aug, 4:07 pm" in the device's own zone, from the server's UTC ISO
 *  timestamp. Returns null (and the row is simply omitted) if it can't parse. */
private fun formatCallStamp(iso: String): String? = runCatching {
    java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()).format(CALL_STAMP_OUT)
}.recoverCatching {
    java.time.OffsetDateTime.parse(iso).atZoneSameInstant(java.time.ZoneId.systemDefault()).format(CALL_STAMP_OUT)
}.getOrNull()

private fun formatFollowupDate(iso: String): String {
    val d = parseFollowup(iso) ?: return iso
    return if (iso.length <= 10) FOLLOWUP_OUT_DATE.format(d) else FOLLOWUP_OUT.format(d)
}

private fun followupColor(iso: String?): Color {
    val d = iso?.let { parseFollowup(it) } ?: return Color(0xFF6B7280)
    val now = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.time
    return when {
        d.before(now) -> Color(0xFFEF4444) // overdue
        d.time - now.time < 86_400_000L -> Color(0xFFF59E0B) // today
        else -> Color(0xFF6366F1) // upcoming
    }
}

internal fun parseDateMillis(s: String): Long? =
    runCatching { ISO_DATE.parse(s)?.time }.getOrNull()

internal fun formatDateMillis(ms: Long): String = ISO_DATE.format(Date(ms))

private fun totalPagesFor(total: Int, pageSize: Int): Int =
    if (total <= 0 || pageSize <= 0) 1 else ((total + pageSize - 1) / pageSize)

// toLocaleString() now lives in util/CountFormat.kt — it was duplicated here and
// in CallsScreen, while every other screen used a bare toString(), so the same
// number rendered differently depending on which tab you were on.
