@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.tasks

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.EventNote
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.PhoneForwarded
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.tutelage.crm.counsellor.ui.components.StatValue
import com.tutelage.crm.counsellor.util.toLocaleString
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.leadwork.TaskBatchDto

/**
 * Counsellor's "Calling Tasks" — batches of leads an admin assigned from the
 * web Lead Workboard. Tapping "View leads" opens the exact same lead-list UI
 * used everywhere else in the app (search / filters / call / follow-up /
 * status change), scoped to just this task's leads — mirrors the web's
 * /app/tasks → "View leads" → /app/leads?ids=... flow.
 */
@Composable
fun TasksScreen(
    onBack: (() -> Unit)? = null,
    onOpenBatch: (Long, String, String) -> Unit,
    onAutoDial: (Long) -> Unit,
    vm: TasksViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val cs = MaterialTheme.colorScheme

    Scaffold(
        containerColor = cs.background,
        topBar = {
            if (onBack != null) {
                TopAppBar(
                    title = { Text("Calling Tasks") },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = cs.onPrimary)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = cs.primary,
                        titleContentColor = cs.onPrimary,
                    ),
                )
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            if (onBack == null) {
                item(key = "__header__") {
                    // Counts are for the day in view, not every task ever assigned —
                    // an all-time total is not a workload a counsellor can act on.
                    Header(
                        total = state.visibleBatches.size,
                        pending = state.visibleBatches.sumOf { it.remaining },
                        refreshing = state.refreshing,
                        onRefresh = vm::refresh,
                    )
                }
            }

            item(key = "__daystrip__") {
                DayStrip(
                    dates = state.availableDates,
                    selected = state.selectedDate,
                    countFor = { date -> state.batches.count { it.workDateLabel == date } },
                    unfinished = state.unfinishedDates,
                    onSelect = vm::selectDate,
                )
            }

            if (state.onSelectedDay.isNotEmpty()) {
                item(key = "__daysummary__") {
                    DaySummary(
                        day = dayHeading(state.selectedDate),
                        done = state.completedOnDay.size,
                        pending = state.pendingOnDay.size,
                    )
                }
            }

            item(key = "__progress__") {
                AnimatedVisibility(
                    visible = state.refreshing && state.batches.isNotEmpty(),
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

            when {
                state.loading && state.batches.isEmpty() -> item(key = "__loading__") {
                    Box(modifier = Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
                state.visibleBatches.isEmpty() -> item(key = "__empty__") {
                    EmptyState(
                        error = state.error,
                        dayLabel = dayHeading(state.selectedDate),
                        unfinishedEarlier = state.unfinishedEarlier,
                    )
                }
                else -> {
                    val pending = state.pendingOnDay
                    val done = state.completedOnDay

                    fun openLeads(batch: TaskBatchDto) {
                        val ids = batch.items.joinToString(",") { it.leadId.toString() }
                        onOpenBatch(batch.id, ids, batch.title)
                    }

                    if (pending.isNotEmpty()) {
                        item(key = "__pending_hdr__") { SectionHeading("Pending · ${pending.size}") }
                        items(items = pending, key = { it.id }) { batch ->
                            TaskCard(
                                batch = batch,
                                onOpenLeads = { openLeads(batch) },
                                onAutoDial = { onAutoDial(batch.id) },
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                            )
                        }
                    }

                    // Completed tasks stay listed for the day rather than vanishing,
                    // so the day's record is still readable after the work is done.
                    if (done.isNotEmpty()) {
                        item(key = "__done_hdr__") {
                            SectionHeading("Completed · ${done.size}", tone = Color(0xFF059669))
                        }
                        items(items = done, key = { "d${it.id}" }) { batch ->
                            TaskCard(
                                batch = batch,
                                onOpenLeads = { openLeads(batch) },
                                onAutoDial = { onAutoDial(batch.id) },
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(total: Int, pending: Int, refreshing: Boolean, onRefresh: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(cs.primary)
            .padding(horizontal = 20.dp, vertical = 18.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "Calling Tasks",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        color = cs.onPrimary,
                    )
                    Text(
                        if (refreshing) "Syncing…" else "Leads assigned to you to call",
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.onPrimary.copy(alpha = 0.85f),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                Surface(
                    shape = CircleShape,
                    color = cs.onPrimary.copy(alpha = 0.18f),
                    modifier = Modifier.size(40.dp).clickable(enabled = !refreshing, onClick = onRefresh),
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                        if (refreshing) {
                            CircularProgressIndicator(color = cs.onPrimary, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = cs.onPrimary, modifier = Modifier.size(20.dp))
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HeaderStat(modifier = Modifier.weight(1f), value = total.toString(), label = "Tasks")
                HeaderStat(modifier = Modifier.weight(1f), value = pending.toString(), label = "Leads pending")
            }
        }
    }
}

// ── Readable dates & titles ──────────────────────────────────────────────────

private val ISO_DAY = java.time.format.DateTimeFormatter.ISO_LOCAL_DATE

private fun parseDay(iso: String?): java.time.LocalDate? =
    iso?.let { runCatching { java.time.LocalDate.parse(it, ISO_DAY) }.getOrNull() }

/** "Today" / "Yesterday" / "Tue, 12 Aug" — never a bare ISO string. */
private fun dayHeading(iso: String?): String {
    val date = parseDay(iso) ?: return "Unscheduled"
    val today = java.time.LocalDate.now()
    return when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        today.plusDays(1) -> "Tomorrow"
        else -> date.format(java.time.format.DateTimeFormatter.ofPattern("EEE, d MMM"))
    }
}

/** Compact form for the day chips: "Today", "Yst", "12 Aug". */
private fun dayChipLabel(iso: String): String {
    val date = parseDay(iso) ?: return iso
    val today = java.time.LocalDate.now()
    return when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yst"
        today.plusDays(1) -> "Tmrw"
        else -> date.format(java.time.format.DateTimeFormatter.ofPattern("d MMM"))
    }
}

/**
 * Server-generated titles read like "Call pending leads created on 2026-08-14" —
 * the same sentence on every card, differing only in a trailing ISO date, and
 * long enough to wrap and clip. Collapse those into a short, scannable label and
 * let the date live in the subtitle where it belongs. A title an admin actually
 * typed is left exactly as written.
 */
private fun readableTitle(batch: TaskBatchDto): String {
    val title = batch.title.trim()
    val generated = Regex("""^(Call pending leads|Complete follow-ups for leads) created on \d{4}-\d{2}-\d{2}$""")
    if (!generated.matches(title)) return title
    val cohort = dayHeading(batch.leadDateLabel)
    val what = if (batch.workType == "FOLLOWUP") "Follow-ups" else "Calls"
    return when {
        batch.leadDateLabel == null -> what
        cohort == "Today" -> "$what · leads from today"
        cohort == "Yesterday" -> "$what · leads from yesterday"
        else -> "$what · leads from $cohort"
    }
}

/** Plain-language status. "READY"/"IN_PROGRESS" are internal names, not answers. */
private fun stateLabel(state: String): String = when (state) {
    "COMPLETED" -> "Done"
    "IN_PROGRESS" -> "In progress"
    "LOCKED" -> "Later"
    else -> "Pending"
}

@Composable
private fun SectionHeading(text: String, tone: Color? = null) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
        color = tone ?: MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 2.dp),
    )
}

/** One line record of the day: what's left and what was finished. */
@Composable
private fun DaySummary(day: String, done: Int, pending: Int) {
    val cs = MaterialTheme.colorScheme
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 2.dp),
    ) {
        Text(
            day,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
            color = cs.onSurface,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (pending > 0) {
            Text(
                "$pending pending",
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = Color(0xFFB45309),
            )
        }
        if (pending > 0 && done > 0) {
            Text(" · ", style = MaterialTheme.typography.labelSmall, color = cs.onSurfaceVariant)
        }
        if (done > 0) {
            Text(
                "$done done",
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = Color(0xFF059669),
            )
        }
    }
}

@Composable
private fun DayStrip(
    dates: List<String>,
    selected: String,
    countFor: (String) -> Int,
    /** Days that still have unfinished tasks. Nothing rolls forward onto today
     *  any more, so an earlier day left half-done has to be findable here. */
    unfinished: Set<String>,
    onSelect: (String) -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(items = dates, key = { it }) { date ->
            val active = date == selected
            val count = countFor(date)
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = if (active) cs.primary else cs.surfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.clickable { onSelect(date) },
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                ) {
                    Text(
                        dayChipLabel(date),
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = if (active) cs.onPrimary else cs.onSurface,
                        maxLines = 1,
                    )
                    if (count > 0) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            count.toString(),
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                            color = if (active) cs.onPrimary.copy(alpha = 0.85f) else cs.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                    if (date in unfinished) {
                        Spacer(Modifier.width(5.dp))
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(if (active) cs.onPrimary else Color(0xFFB45309)),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HeaderStat(modifier: Modifier = Modifier, value: String, label: String) {
    val cs = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(14.dp), color = cs.onPrimary.copy(alpha = 0.12f), modifier = modifier) {
        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            StatValue(
                text = value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = cs.onPrimary,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = cs.onPrimary.copy(alpha = 0.80f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun TaskCard(
    batch: TaskBatchDto,
    onOpenLeads: () -> Unit,
    onAutoDial: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    val completed = batch.state == "COMPLETED"
    val (stateBg, stateFg) = when (batch.state) {
        "COMPLETED" -> Color(0xFFD1FAE5) to Color(0xFF065F46)
        "IN_PROGRESS" -> Color(0xFFDBEAFE) to Color(0xFF1D4ED8)
        "LOCKED" -> cs.surfaceVariant to cs.onSurfaceVariant
        else -> Color(0xFFFEF3C7) to Color(0xFF92400E)
    }
    // Day-wise number: "Task 2 of 3" for this counsellor on this work date.
    // `sequence` is the stored allocation and goes sparse as tasks get deleted,
    // so it is only a fallback for a backend that doesn't send the day numbers.
    val dayNo = if (batch.daySequence > 0) batch.daySequence else batch.sequence
    val dayCount = batch.dayTaskCount
    Card(
        shape = RoundedCornerShape(18.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        // A finished task goes green end to end — the whole card, not just the
        // pill, so a day's progress reads at a glance while scrolling.
        colors = CardDefaults.cardColors(containerColor = if (completed) Color(0xFFECFDF5) else cs.surface),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (completed) Color(0xFF059669) else cs.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    if (completed) {
                        Icon(
                            Icons.Outlined.CheckCircle,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(20.dp),
                        )
                    } else {
                        Icon(
                            if (batch.workType == "FOLLOWUP") Icons.Outlined.EventNote else Icons.Outlined.PhoneForwarded,
                            contentDescription = null,
                            tint = cs.onPrimaryContainer,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (dayCount > 0) "Task $dayNo of $dayCount" else "Task $dayNo",
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                        color = if (completed) Color(0xFF047857) else cs.primary,
                        maxLines = 1,
                    )
                    Text(
                        readableTitle(batch),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = cs.onSurface,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        dayHeading(batch.workDateLabel),
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Surface(shape = RoundedCornerShape(999.dp), color = stateBg) {
                    Text(
                        stateLabel(batch.state),
                        color = stateFg,
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                        maxLines = 1,
                        softWrap = false,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }

            Spacer(Modifier.height(12.dp))
            Column {
                val progress = (batch.progress / 100f).coerceIn(0f, 1f)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(cs.surfaceVariant),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(progress)
                            .fillMaxSize()
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (completed) Color(0xFF10B981) else cs.primary),
                    )
                }
                Spacer(Modifier.height(6.dp))
                // Neither side was weighted, so with large counts these two collided
                // and the right-hand "N pending" was clipped. The left label now
                // ellipsizes; the pending count keeps its full width.
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(
                        "${batch.completed.toLocaleString()} of ${batch.total.toLocaleString()} done",
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "${batch.remaining.toLocaleString()} pending",
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = if (batch.remaining > 0) Color(0xFFB45309) else Color(0xFF059669),
                        maxLines = 1,
                        softWrap = false,
                    )
                }
            }

            // What the calls actually produced — the same three numbers the web
            // task row carries. Without them the card only says how many leads
            // were touched, not whether anyone was reached.
            batch.summary?.let { summary ->
                if (summary.connected > 0 || summary.noAnswer > 0 || summary.followupsCreated > 0) {
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (summary.connected > 0) {
                            OutcomeChip("${summary.connected} answered", Color(0xFFD1FAE5), Color(0xFF065F46))
                        }
                        if (summary.noAnswer > 0) {
                            OutcomeChip("${summary.noAnswer} no answer", Color(0xFFFEF3C7), Color(0xFF92400E))
                        }
                        if (summary.followupsCreated > 0) {
                            OutcomeChip("${summary.followupsCreated} follow-ups", Color(0xFFE0E7FF), Color(0xFF3730A3))
                        }
                    }
                }
            }

            batch.notes?.takeIf { it.isNotBlank() }?.let { notes ->
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFFFEF3C7))
                        .padding(10.dp),
                ) {
                    Icon(Icons.Outlined.StickyNote2, contentDescription = null, tint = Color(0xFF92400E), modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(notes, style = MaterialTheme.typography.labelSmall, color = Color(0xFF78350F))
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = cs.primary,
                    modifier = Modifier
                        .weight(1f)
                        .height(44.dp)
                        .clickable(enabled = batch.items.isNotEmpty(), onClick = onOpenLeads),
                ) {
                    Row(
                        modifier = Modifier.fillMaxSize(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(Icons.Outlined.ListAlt, contentDescription = null, tint = cs.onPrimary, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "View leads (${batch.total})",
                            color = cs.onPrimary,
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                        )
                    }
                }
                if (batch.remaining > 0) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xFF7C3AED),
                        modifier = Modifier
                            .weight(1f)
                            .height(44.dp)
                            .clickable(onClick = onAutoDial),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxSize(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            Icon(Icons.Filled.Call, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "Auto Dial",
                                color = Color.White,
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OutcomeChip(text: String, bg: Color, fg: Color) {
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Text(
            text,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = fg,
            maxLines = 1,
            softWrap = false,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun EmptyState(error: String?, dayLabel: String = "today", unfinishedEarlier: Int = 0) {
    val cs = MaterialTheme.colorScheme
    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier.size(72.dp).clip(CircleShape).background(cs.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (error != null) Icons.Outlined.Inbox else Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    tint = cs.onSurfaceVariant,
                    modifier = Modifier.size(36.dp),
                )
            }
            Spacer(Modifier.height(14.dp))
            Text(
                if (error != null) "Couldn't load tasks" else "Nothing for ${dayLabel.lowercase()}",
                style = MaterialTheme.typography.titleMedium,
                color = cs.onSurface,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                error ?: "Pick another day above, or wait for an admin to assign leads from the workboard.",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            // Tasks stay on their own day now, so an empty day must say when
            // there is still older work — otherwise this reads as "all clear".
            if (error == null && unfinishedEarlier > 0) {
                Spacer(Modifier.height(10.dp))
                Surface(shape = RoundedCornerShape(12.dp), color = Color(0xFFFEF3C7)) {
                    Text(
                        "$unfinishedEarlier task${if (unfinishedEarlier == 1) "" else "s"} " +
                            "still unfinished on earlier days — tap a dated chip above (they have an amber dot).",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color(0xFF92400E),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    )
                }
            }
        }
    }
}
