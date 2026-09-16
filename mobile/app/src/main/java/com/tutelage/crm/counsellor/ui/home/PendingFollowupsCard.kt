@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.dashboard.FollowupLeadDto
import androidx.compose.ui.text.style.TextOverflow
import com.tutelage.crm.counsellor.util.maskPhone
import com.tutelage.crm.counsellor.util.toBadgeCount
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Tabbed "Pending Follow-ups" widget that mirrors the web dashboard's
 * PendingFollowupsWidget. Three tabs (Today / Overdue / Next 7) with count
 * chips, scrollable list of leads underneath, tap to open lead detail.
 *
 * The counts come from the parent HomeViewModel's overview so they stay in
 * sync with the rest of the home screen; the lead lists are owned by this
 * widget's own ViewModel.
 */
@Composable
fun PendingFollowupsCard(
    todayCount: Int,
    overdueCount: Int,
    upcomingCount: Int,
    onOpenLead: (Long) -> Unit,
    onSeeAll: (FollowupBucket) -> Unit,
    vm: PendingFollowupsViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val cs = MaterialTheme.colorScheme

    Card(
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            // ─── Header ────────────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Pending Follow-ups",
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.Bold,
                    ),
                    color = cs.onSurface,
                    modifier = Modifier.weight(1f),
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.clickable { onSeeAll(state.active) },
                ) {
                    Text(
                        "View all",
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = cs.primary,
                    )
                    Icon(
                        Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                        contentDescription = null,
                        tint = cs.primary,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            HorizontalDivider(color = cs.outlineVariant)

            // ─── Tabs ──────────────────────────────────────────────────────
            BucketTabs(
                active = state.active,
                today = todayCount,
                overdue = overdueCount,
                upcoming = upcomingCount,
                onSelect = vm::selectBucket,
            )
            HorizontalDivider(color = cs.outlineVariant)

            // ─── Slim refresh indicator ────────────────────────────────────
            if (state.refreshing) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                    color = cs.primary,
                    trackColor = Color.Transparent,
                )
            }

            // ─── List ──────────────────────────────────────────────────────
            val leads = state.byBucket[state.active].orEmpty()
            when {
                state.loading && leads.isEmpty() -> CenteredSpinner()
                state.error != null && leads.isEmpty() -> ErrorRow(state.error!!)
                leads.isEmpty() -> EmptyRow(bucket = state.active)
                else -> Column {
                    // Don't use LazyColumn here — we're inside an outer LazyColumn,
                    // so we render up to a sensible cap (10) and link "View all"
                    // out to the dedicated Followups screen for the rest.
                    leads.take(10).forEachIndexed { idx, lead ->
                        FollowupRow(
                            lead = lead,
                            isOverdue = state.active == FollowupBucket.OVERDUE,
                            onClick = { onOpenLead(lead.id) },
                        )
                        if (idx < leads.lastIndex.coerceAtMost(9)) {
                            HorizontalDivider(
                                color = cs.outlineVariant,
                                modifier = Modifier.padding(horizontal = 18.dp),
                            )
                        }
                    }
                    if (leads.size > 10) {
                        HorizontalDivider(color = cs.outlineVariant)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSeeAll(state.active) }
                                .padding(horizontal = 18.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // Name how many are hidden, not just the total — the list
                            // above is cut to 10, so "+37 more" is the number the
                            // counsellor actually can't see.
                            Text(
                                "Show all ${leads.size} · +${leads.size - 10} more",
                                style = MaterialTheme.typography.labelMedium.copy(
                                    fontWeight = FontWeight.SemiBold,
                                ),
                                color = cs.primary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            Icon(
                                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                                contentDescription = null,
                                tint = cs.primary,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BucketTabs(
    active: FollowupBucket,
    today: Int,
    overdue: Int,
    upcoming: Int,
    onSelect: (FollowupBucket) -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth()) {
        BucketTab(
            modifier = Modifier.weight(1f),
            label = "Today",
            count = today,
            icon = Icons.Outlined.CalendarMonth,
            active = active == FollowupBucket.TODAY,
            tone = MaterialTheme.colorScheme.primary,
            onClick = { onSelect(FollowupBucket.TODAY) },
        )
        BucketTab(
            modifier = Modifier.weight(1f),
            label = "Overdue",
            count = overdue,
            icon = Icons.Outlined.EventBusy,
            active = active == FollowupBucket.OVERDUE,
            tone = MaterialTheme.colorScheme.error,
            urgent = overdue > 0,
            onClick = { onSelect(FollowupBucket.OVERDUE) },
        )
        BucketTab(
            modifier = Modifier.weight(1f),
            label = "Next 7",
            count = upcoming,
            icon = Icons.Outlined.EventAvailable,
            active = active == FollowupBucket.UPCOMING,
            tone = MaterialTheme.colorScheme.tertiary,
            onClick = { onSelect(FollowupBucket.UPCOMING) },
        )
    }
}

@Composable
private fun BucketTab(
    modifier: Modifier = Modifier,
    label: String,
    count: Int,
    icon: ImageVector,
    active: Boolean,
    tone: Color,
    urgent: Boolean = false,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val contentColor = if (active) cs.onSurface else cs.onSurfaceVariant
    Box(
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 12.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = if (active) tone else cs.onSurfaceVariant,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(6.dp))
                // Weighted with fill = false so the count pill (unweighted, measured
                // first at its natural size) always keeps its full width and the
                // label ellipsizes instead. Previously the label ate the row and the
                // pill — the last child — was the part that got clipped, which is
                // what made the number look cut in half.
                Text(
                    label,
                    style = MaterialTheme.typography.labelLarge.copy(
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    ),
                    color = contentColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.width(6.dp))
                Surface(
                    shape = RoundedCornerShape(50),
                    color = if (urgent) cs.errorContainer else cs.surfaceVariant,
                ) {
                    Text(
                        count.toBadgeCount(999),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.Bold,
                        ),
                        color = if (urgent) cs.onErrorContainer else cs.onSurfaceVariant,
                        maxLines = 1,
                        softWrap = false,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            // Bottom indicator bar — coloured when active, transparent otherwise.
            Box(
                modifier = Modifier
                    .height(2.dp)
                    .width(28.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (active) tone else Color.Transparent),
            )
        }
    }
}

@Composable
private fun FollowupRow(
    lead: FollowupLeadDto,
    isOverdue: Boolean,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    lead.name?.takeIf { it.isNotBlank() } ?: "(unnamed lead)",
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = cs.onSurface,
                    maxLines = 1,
                    modifier = Modifier.weight(1f, fill = false),
                )
                lead.leadStatus?.takeIf { it.isNotBlank() }?.let { status ->
                    Spacer(Modifier.width(8.dp))
                    StatusPill(status = status, subStatus = lead.leadSubStatus)
                }
            }
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                lead.mobile?.takeIf { it.isNotBlank() }?.let { mobile ->
                    Icon(
                        Icons.Outlined.Phone,
                        contentDescription = null,
                        tint = cs.outline,
                        modifier = Modifier.size(12.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        maskPhone(mobile),
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.onSurfaceVariant,
                    )
                    Spacer(Modifier.width(10.dp))
                }
                lead.followupDate?.let { date ->
                    Text(
                        formatFollowupDate(date),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = if (isOverdue) FontWeight.SemiBold else FontWeight.Normal,
                        ),
                        color = if (isOverdue) cs.error else cs.onSurface,
                    )
                }
            }
        }
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = cs.outline,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun StatusPill(status: String, subStatus: String?) {
    val cs = MaterialTheme.colorScheme
    val (bg, fg) = when (status.lowercase()) {
        "hot", "interested", "qualified" -> cs.tertiaryContainer to cs.onTertiaryContainer
        "warm", "follow-up", "followup" -> cs.secondaryContainer to cs.onSecondaryContainer
        "cold", "not interested", "lost", "junk" -> cs.errorContainer to cs.onErrorContainer
        else -> cs.surfaceVariant to cs.onSurfaceVariant
    }
    val label = if (!subStatus.isNullOrBlank()) "$status · $subStatus" else status
    Surface(
        shape = RoundedCornerShape(50),
        color = bg,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            color = fg,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            maxLines = 1,
        )
    }
}

@Composable
private fun CenteredSpinner() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 100.dp)
            .padding(vertical = 28.dp),
        contentAlignment = Alignment.Center,
    ) { CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(22.dp)) }
}

@Composable
private fun EmptyRow(bucket: FollowupBucket) {
    val cs = MaterialTheme.colorScheme
    val message = when (bucket) {
        FollowupBucket.OVERDUE -> "No overdue follow-ups — nice work."
        FollowupBucket.TODAY -> "No follow-ups scheduled for today."
        FollowupBucket.UPCOMING -> "Nothing in the next 7 days."
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.Inbox,
            contentDescription = null,
            tint = cs.outline,
            modifier = Modifier.size(32.dp),
        )
        Spacer(Modifier.height(8.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = cs.onSurfaceVariant,
        )
    }
}

@Composable
private fun ErrorRow(message: String) {
    val cs = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(18.dp),
    ) {
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = cs.error,
        )
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

private val isoIn = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
private val outShort = SimpleDateFormat("d MMM, HH:mm", Locale.getDefault())
private val outDay = SimpleDateFormat("d MMM", Locale.getDefault())

private fun formatFollowupDate(iso: String): String {
    return runCatching {
        val parsed = isoIn.parse(iso.substring(0, 19))!!
        val now = java.util.Calendar.getInstance()
        val cal = java.util.Calendar.getInstance().apply { time = parsed }
        val sameDay = now.get(java.util.Calendar.YEAR) == cal.get(java.util.Calendar.YEAR) &&
            now.get(java.util.Calendar.DAY_OF_YEAR) == cal.get(java.util.Calendar.DAY_OF_YEAR)
        if (sameDay) outShort.format(parsed) else outDay.format(parsed)
    }.getOrDefault(iso.take(10))
}
