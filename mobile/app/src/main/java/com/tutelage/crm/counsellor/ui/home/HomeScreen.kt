@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.home

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.outlined.CallMade
import androidx.compose.material.icons.automirrored.outlined.CallReceived
import androidx.compose.material.icons.outlined.ArrowOutward
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.DoNotDisturbOn
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.PhoneDisabled
import androidx.compose.material.icons.outlined.PhoneInTalk
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.tutelage.crm.counsellor.ui.components.StatValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.dashboard.HomeOverviewDto
import com.tutelage.crm.counsellor.data.dashboard.NextFollowupDto
import com.tutelage.crm.counsellor.data.dashboard.RecentCallDto
import com.tutelage.crm.counsellor.data.dashboard.WeekDayDto
import com.tutelage.crm.counsellor.ui.theme.BrandPink
import com.tutelage.crm.counsellor.util.maskPhone
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// Bold fintech-style hero gradient: slate-950 → indigo-700 → violet-600.
private val HeroGradient: Brush = Brush.linearGradient(
    colors = listOf(
        Color(0xFF0B1029), // near-black with a hint of indigo
        Color(0xFF312E81), // indigo-900
        Color(0xFF6D28D9), // violet-700
    ),
)

@Composable
fun HomeScreen(
    onOpenFollowups: (String) -> Unit = {},
    onOpenAutoDialer: () -> Unit = {},
    onOpenLead: (Long) -> Unit = {},
    onOpenTasks: () -> Unit = {},
    vm: HomeViewModel = hiltViewModel(),
    tasksVm: com.tutelage.crm.counsellor.ui.tasks.TasksViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val tasksState by tasksVm.state.collectAsStateWithLifecycle()
    val cs = MaterialTheme.colorScheme
    val d = state.data
    // Observable clock for the stale-data banner below. 30s, not 1s: the
    // threshold it feeds is 90 seconds, so a per-second tick would recompose
    // this whole screen 30x more often than the UI can possibly show.
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            kotlinx.coroutines.delay(30_000)
            nowMs = System.currentTimeMillis()
        }
    }

    Scaffold(containerColor = cs.background) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = 16.dp,
                bottom = 28.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            item(key = "hero") {
                HeroCard(
                    userName = state.userName,
                    answered = d?.today?.answered ?: 0,
                    totalCalls = d?.today?.total ?: 0,
                    refreshing = state.refreshing,
                    onRefresh = vm::refresh,
                )
            }

            state.error?.let { msg ->
                item(key = "err") { ErrorBanner(message = msg, onRetry = vm::refresh) }
            }

            // Stale-data warning — surfaces silently if polling has been
            // failing for a while so the counsellor knows the numbers are
            // not live.
            //
            // Driven by `nowMs`, NOT a bare System.currentTimeMillis() read in
            // the composition body: Compose can't know a plain clock read
            // changed, so nothing ever scheduled the recomposition that would
            // make this banner appear. It only showed if some unrelated state
            // change happened to recompose Home — which, for a poll that hangs
            // rather than fails, never came.
            val lastMs = state.lastRefreshedAtMs
            if (state.error == null && lastMs != null && nowMs - lastMs > 90_000) {
                item(key = "stale") {
                    StaleBanner(
                        secondsAgo = ((nowMs - lastMs) / 1000L).toInt(),
                        onRetry = vm::refresh,
                    )
                }
            }

            // Next followup — surfaced ABOVE everything else because it's the
            // single most important card for a counsellor: who to call next.
            d?.nextFollowup?.let { nf ->
                item(key = "nf") {
                    NextFollowupCard(
                        next = nf,
                        onCall = { /* handled internally with LocalContext */ },
                        onOpen = { onOpenLead(nf.id) },
                    )
                }
            }

            // Calling Tasks — leads an admin assigned from the web Lead
            // Workboard. Only shown once loaded and non-empty so counsellors
            // with no assigned tasks don't see an empty promo card.
            // Split today vs earlier: the Tasks screen opens on TODAY and no
            // longer drags older tasks forward, so a card counting every open
            // task would promise work that screen then doesn't show.
            val todayIso = java.time.LocalDate.now().toString()
            val openTaskBatches = tasksState.batches.filter { it.state != "COMPLETED" }
            val todayOpen = openTaskBatches.filter { it.workDateLabel == todayIso }
            val earlierOpen = openTaskBatches.count { (it.workDateLabel ?: todayIso) < todayIso }
            if (openTaskBatches.isNotEmpty()) {
                item(key = "tasks-card") {
                    TasksSummaryCard(
                        taskCount = todayOpen.size,
                        pendingLeads = todayOpen.sumOf { it.remaining },
                        earlierCount = earlierOpen,
                        onClick = onOpenTasks,
                    )
                }
            }

            // 6 high-density stat chips below the hero. Total goes first so
            // counsellors see the day's volume at a glance; MISSED (incoming we
            // didn't pick) and NO ANSWER (outgoing that rang out) are split into
            // their own tiles — collapsing them hid which leads still need a
            // call-back.
            item(key = "mini-stats") {
                MiniStatRow(
                    total = d?.today?.total ?: 0,
                    answered = d?.today?.answered ?: 0,
                    missed = d?.today?.missed ?: 0,
                    noAnswer = d?.today?.noAnswer ?: 0,
                    rejected = d?.today?.rejected ?: 0,
                    talkSec = d?.today?.totalDurationSec ?: 0,
                )
            }

            // "Your day" — full tabbed widget (mirrors the web dashboard).
            item(key = "fu-tabs") {
                PendingFollowupsCard(
                    todayCount = d?.followups?.today ?: 0,
                    overdueCount = d?.followups?.overdue ?: 0,
                    upcomingCount = d?.followups?.upcoming ?: 0,
                    onOpenLead = onOpenLead,
                    onSeeAll = { bucket ->
                        onOpenFollowups(when (bucket) {
                            FollowupBucket.TODAY -> "today"
                            FollowupBucket.OVERDUE -> "overdue"
                            FollowupBucket.UPCOMING -> "upcoming"
                        })
                    },
                )
            }

            // Recent calls strip — only meaningful if there are any.
            if (!d?.recentCalls.isNullOrEmpty()) {
                item(key = "rc-h") { SectionLabel("Recent calls", topPadding = 6) }
                item(key = "rc-row") {
                    RecentCallsStrip(
                        calls = d!!.recentCalls,
                        onTap = { leadId -> if (leadId != null) onOpenLead(leadId) },
                    )
                }
            }

            // Week bar chart — guard against an empty list from older backends.
            if (!d?.weekStats.isNullOrEmpty()) {
                item(key = "wk-h") { SectionLabel("This week", topPadding = 6) }
                item(key = "wk-chart") { WeekBarChart(days = d!!.weekStats) }
            }

            // Auto-dialer disabled — Outbound section commented out.
            // item(key = "out-h") { SectionLabel("Outbound", topPadding = 6) }
            // item(key = "out-1") { AutoDialerCard(onClick = onOpenAutoDialer) }
        }
    }
}

// ─── Hero with progress ring ─────────────────────────────────────────────────

@Composable
private fun HeroCard(
    userName: String?,
    answered: Int,
    totalCalls: Int,
    refreshing: Boolean,
    onRefresh: () -> Unit,
) {
    val firstName = remember(userName) {
        userName?.split(" ")?.firstOrNull()?.takeIf { it.isNotBlank() } ?: "there"
    }
    val greeting = remember { greetingForTimeOfDay() }
    val today = remember { dateFormatter.format(Date()) }
    val answerRate = if (totalCalls <= 0) 0f else (answered.toFloat() / totalCalls).coerceIn(0f, 1f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(HeroGradient)
            .padding(22.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LivePulse()
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Live · synced",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.80f),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        greeting,
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White.copy(alpha = 0.78f),
                    )
                    Text(
                        firstName,
                        style = MaterialTheme.typography.displaySmall.copy(
                            fontWeight = FontWeight.Bold,
                        ),
                        color = Color.White,
                    )
                    Text(
                        today,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.70f),
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                IconButton(
                    onClick = onRefresh,
                    enabled = !refreshing,
                ) {
                    if (refreshing) {
                        CircularProgressIndicator(
                            color = Color.White,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(22.dp),
                        )
                    } else {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = "Refresh",
                            tint = Color.White,
                        )
                    }
                }
            }

            Spacer(Modifier.height(20.dp))

            // Progress ring + answer-rate copy
            Row(verticalAlignment = Alignment.CenterVertically) {
                AnswerRing(progress = answerRate, total = totalCalls)
                Spacer(Modifier.width(20.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "Answer rate",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White.copy(alpha = 0.78f),
                    )
                    Text(
                        if (totalCalls == 0) "No calls yet" else "$answered of $totalCalls calls",
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = Color.White,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when {
                            totalCalls == 0 -> "Start your first call to see stats."
                            answerRate >= 0.7f -> "Great answer rate today 👏"
                            answerRate >= 0.4f -> "Keep at it — answers will climb."
                            else -> "Try a few followups to lift the rate."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.78f),
                    )
                }
            }
        }
    }
}

@Composable
private fun AnswerRing(progress: Float, total: Int) {
    val animated by animateFloatAsState(
        targetValue = progress,
        animationSpec = tween(durationMillis = 750),
        label = "ring",
    )
    Box(
        modifier = Modifier.size(110.dp),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 12f
            val arcSize = Size(size.width - stroke, size.height - stroke)
            val topLeft = Offset(stroke / 2, stroke / 2)

            // Track
            drawArc(
                color = Color.White.copy(alpha = 0.18f),
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
            // Progress sweep — gradient stroke
            drawArc(
                brush = Brush.sweepGradient(
                    colors = listOf(
                        Color(0xFF34D399), // emerald-400
                        Color(0xFF60A5FA), // blue-400
                        Color(0xFFA78BFA), // violet-400
                        Color(0xFF34D399),
                    ),
                ),
                startAngle = -90f,
                sweepAngle = animated * 360f,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                if (total == 0) "—" else "${(progress * 100).toInt()}%",
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.Bold,
                ),
                color = Color.White,
            )
            Text(
                "answered",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.75f),
            )
        }
    }
}

@Composable
private fun LivePulse() {
    // A subtle blinking dot to communicate "data is live, no need to refresh."
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

// ─── Next followup card ──────────────────────────────────────────────────────

@Composable
private fun NextFollowupCard(
    next: NextFollowupDto,
    onCall: () -> Unit,
    onOpen: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme

    // The countdown below is rendered in whole minutes, so re-evaluating it
    // every second recomposed this card 59 times for nothing. 20s keeps the
    // minute boundary visibly prompt without a 1 Hz invalidation loop.
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(20_000)
            nowMs = System.currentTimeMillis()
        }
    }
    val followupMs = remember(next.followupDate) { parseIsoMs(next.followupDate) }
    val diffMin = if (followupMs != null) ((followupMs - nowMs) / 60_000L).toInt() else null
    val countdown = when {
        diffMin == null -> ""
        diffMin <= 0 -> "due now"
        diffMin < 60 -> "in ${diffMin}m"
        diffMin < 60 * 24 -> "in ${diffMin / 60}h ${diffMin % 60}m"
        else -> "in ${diffMin / 1440}d"
    }
    val urgent = diffMin != null && diffMin <= 15

    Card(
        shape = RoundedCornerShape(22.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (urgent) cs.primaryContainer else cs.surface,
        ),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(cs.primary.copy(alpha = 0.18f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Bolt,
                        contentDescription = null,
                        tint = cs.primary,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    "NEXT FOLLOWUP",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 1.sp,
                    ),
                    color = cs.primary,
                    modifier = Modifier.weight(1f),
                )
                Surface(
                    shape = RoundedCornerShape(50),
                    color = if (urgent) cs.error.copy(alpha = 0.15f) else cs.primary.copy(alpha = 0.12f),
                ) {
                    Text(
                        countdown,
                        color = if (urgent) cs.error else cs.primary,
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                        ),
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            Text(
                next.name ?: "(unnamed lead)",
                style = MaterialTheme.typography.titleLarge.copy(
                    fontWeight = FontWeight.Bold,
                ),
                color = cs.onSurface,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                maskPhone(next.mobile),
                style = MaterialTheme.typography.bodyMedium,
                color = cs.onSurfaceVariant,
            )
            next.leadStatus?.takeIf { it.isNotBlank() }?.let { status ->
                Spacer(Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(50),
                    color = cs.secondaryContainer,
                ) {
                    Text(
                        status,
                        color = cs.onSecondaryContainer,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CallButton(
                    phoneNumber = next.mobile,
                    onCall = onCall,
                    modifier = Modifier.weight(1f),
                )
                OutlineButtonPill(
                    text = "Open lead",
                    onClick = onOpen,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun CallButton(
    phoneNumber: String?,
    onCall: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme
    val enabled = !phoneNumber.isNullOrBlank()
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (enabled) cs.primary else cs.surfaceVariant,
        modifier = modifier
            .height(46.dp)
            .clickable(enabled = enabled) {
                if (phoneNumber.isNullOrBlank()) return@clickable
                onCall()
                // Use ACTION_CALL since we already hold CALL_PHONE permission.
                runCatching {
                    val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$phoneNumber"))
                    ContextCompat.startActivity(context, intent, null)
                }
            },
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                Icons.Outlined.Call,
                contentDescription = null,
                tint = if (enabled) cs.onPrimary else cs.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "Call now",
                color = if (enabled) cs.onPrimary else cs.onSurfaceVariant,
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
            )
        }
    }
}

@Composable
private fun OutlineButtonPill(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = cs.surfaceVariant,
        modifier = modifier.height(46.dp).clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Text(
                text,
                color = cs.onSurfaceVariant,
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
            )
        }
    }
}

// ─── Calling Tasks entry point ───────────────────────────────────────────────

@Composable
private fun TasksSummaryCard(taskCount: Int, pendingLeads: Int, earlierCount: Int, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(HeroGradient),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.ListAlt,
                    contentDescription = null,
                    tint = Color.White,
                )
            }
            Spacer(Modifier.size(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Calling Tasks",
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                )
                Text(
                    if (taskCount == 0) "Nothing for today"
                    else "$taskCount task${if (taskCount == 1) "" else "s"} today · $pendingLeads lead${if (pendingLeads == 1) "" else "s"} to call",
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
                if (earlierCount > 0) {
                    Text(
                        "$earlierCount unfinished from earlier days",
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = Color(0xFFB45309),
                    )
                }
            }
            Icon(Icons.Outlined.ArrowOutward, contentDescription = null, tint = cs.outline)
        }
    }
}

// ─── Mini stat row ───────────────────────────────────────────────────────────

@Composable
private fun MiniStatRow(
    total: Int,
    answered: Int,
    missed: Int,
    noAnswer: Int,
    rejected: Int,
    talkSec: Int,
) {
    val cs = MaterialTheme.colorScheme
    // 3 columns × 2 rows. Total goes first; MISSED and NO ANSWER are split into
    // their own tiles so counsellors can tell which leads still need a call-back
    // (NO ANSWER) vs which calls they themselves missed (MISSED).
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MiniStat(
                modifier = Modifier.weight(1f),
                label = "Total",
                value = total.toString(),
                icon = Icons.Outlined.Phone,
                accent = cs.primary,
            )
            MiniStat(
                modifier = Modifier.weight(1f),
                label = "Answered",
                value = answered.toString(),
                icon = Icons.Outlined.PhoneInTalk,
                accent = cs.tertiary,
            )
            MiniStat(
                modifier = Modifier.weight(1f),
                label = "Missed",
                value = missed.toString(),
                icon = Icons.Outlined.CallEnd,
                accent = BrandPink,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            MiniStat(
                modifier = Modifier.weight(1f),
                label = "No answer",
                value = noAnswer.toString(),
                icon = Icons.Outlined.PhoneDisabled,
                accent = cs.error.copy(alpha = 0.85f),
            )
            MiniStat(
                modifier = Modifier.weight(1f),
                label = "Rejected",
                value = rejected.toString(),
                icon = Icons.Outlined.DoNotDisturbOn,
                accent = cs.error,
            )
            MiniStat(
                modifier = Modifier.weight(1f),
                label = "Talk time",
                value = formatDuration(talkSec),
                icon = Icons.Outlined.Schedule,
                accent = cs.secondary,
            )
        }
    }
}

@Composable
private fun MiniStat(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
    icon: ImageVector,
    accent: Color,
) {
    val cs = MaterialTheme.colorScheme
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(accent.copy(alpha = 0.15f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(16.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            // Tiles are weight(1f), three to a row — a bold 22sp four-digit value
            // used to wrap and shove the label out of the card. Shrink to fit instead.
            StatValue(
                text = value,
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                color = cs.onSurface,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = cs.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ─── Recent calls strip ──────────────────────────────────────────────────────

@Composable
private fun RecentCallsStrip(calls: List<RecentCallDto>, onTap: (Long?) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(items = calls, key = { it.id }) { c ->
            RecentCallChip(call = c, onClick = { onTap(c.lead?.id) })
        }
    }
}

@Composable
private fun RecentCallChip(call: RecentCallDto, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val name = call.lead?.name?.takeIf { it.isNotBlank() } ?: call.phoneNumber
    val initials = remember(name) {
        name.split(" ").filter { it.isNotBlank() }.take(2)
            .joinToString("") { it.first().uppercase() }.ifBlank { "?" }
    }
    val avatarBg = remember(name) { palette[(name.hashCode().let { if (it < 0) -it else it }) % palette.size] }
    val (icon, tint) = when {
        call.direction == "OUTGOING" -> Icons.AutoMirrored.Outlined.CallMade to cs.tertiary
        call.status.equals("MISSED", true) -> Icons.Outlined.Call to cs.error
        else -> Icons.AutoMirrored.Outlined.CallReceived to cs.secondary
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .width(76.dp)
            .clickable(onClick = onClick),
    ) {
        Box(contentAlignment = Alignment.BottomEnd) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(avatarBg),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initials,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 18.sp,
                )
            }
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(cs.background),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            name,
            style = MaterialTheme.typography.labelSmall,
            color = cs.onSurface,
            maxLines = 1,
            fontWeight = FontWeight.Medium,
        )
        Text(
            if (call.durationSec > 0) formatDuration(call.durationSec) else call.status.lowercase(),
            style = MaterialTheme.typography.labelSmall,
            color = cs.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

private val palette = listOf(
    Color(0xFF6366F1), Color(0xFF0EA5E9), Color(0xFF10B981),
    Color(0xFFF59E0B), Color(0xFFEF4444), Color(0xFF8B5CF6),
    Color(0xFFEC4899), Color(0xFF14B8A6),
)

// ─── Week chart ──────────────────────────────────────────────────────────────

@Composable
private fun WeekBarChart(days: List<WeekDayDto>) {
    val cs = MaterialTheme.colorScheme
    // remember(days): Home recomposes on every poll and on the pulse/countdown
    // ticks, and these three passes over the list were redone each time.
    val max = remember(days) { (days.maxOfOrNull { it.count } ?: 0).coerceAtLeast(1) }
    val best = remember(days) { days.maxByOrNull { it.count } }
    val weekTotal = remember(days) { days.sumOf { it.count } }
    Card(
        shape = RoundedCornerShape(20.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Last 7 days",
                    style = MaterialTheme.typography.labelMedium,
                    color = cs.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "$weekTotal total",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = cs.onSurface,
                )
            }
            Spacer(Modifier.height(12.dp))
            BoxWithConstraints {
                val barWidth = maxWidth / (days.size * 2)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(110.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Bottom,
                ) {
                    days.forEach { day ->
                        val ratio = day.count.toFloat() / max
                        val animated by animateFloatAsState(
                            targetValue = ratio,
                            animationSpec = tween(durationMillis = 600),
                            label = "bar-${day.date}",
                        )
                        val isBest = best != null && day.count > 0 && day.count == best.count
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.fillMaxHeight(),
                            verticalArrangement = Arrangement.Bottom,
                        ) {
                            Box(
                                modifier = Modifier
                                    .width(barWidth)
                                    .fillMaxHeight(animated.coerceAtLeast(0.04f))
                                    .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp))
                                    .background(
                                        Brush.verticalGradient(
                                            colors = if (isBest) {
                                                listOf(cs.primary, cs.tertiary)
                                            } else {
                                                listOf(
                                                    cs.primary.copy(alpha = 0.85f),
                                                    cs.primary.copy(alpha = 0.55f),
                                                )
                                            },
                                        ),
                                    ),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                days.forEach { day ->
                    Text(
                        labelForDate(day.date),
                        style = MaterialTheme.typography.labelSmall,
                        color = cs.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// ─── Auto Dialer + atoms (DISABLED — feature commented out) ──────────────────

/*
@Composable
private fun AutoDialerCard(onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(20.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.5.dp),
        colors = CardDefaults.cardColors(containerColor = cs.surface),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(HeroGradient),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Campaign, contentDescription = null, tint = Color.White)
            }
            Spacer(Modifier.size(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Auto Dialer",
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                )
                Text(
                    "Run an assigned campaign",
                    style = MaterialTheme.typography.bodySmall,
                    color = cs.onSurfaceVariant,
                )
            }
            Icon(Icons.Outlined.ArrowOutward, contentDescription = null, tint = cs.outline)
        }
    }
}
*/

@Composable
private fun SectionLabel(text: String, topPadding: Int = 0) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
        color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.padding(top = topPadding.dp, start = 4.dp),
    )
}

@Composable
private fun ErrorBanner(message: String, onRetry: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = cs.errorContainer),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onRetry),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Default.Refresh,
                contentDescription = null,
                tint = cs.onErrorContainer,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Couldn't sync",
                    color = cs.onErrorContainer,
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                )
                Text(
                    message,
                    color = cs.onErrorContainer,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Text(
                "Tap to retry",
                color = cs.onErrorContainer,
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            )
        }
    }
}

@Composable
private fun StaleBanner(secondsAgo: Int, onRetry: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val timeText = when {
        secondsAgo < 60 -> "${secondsAgo}s"
        secondsAgo < 3600 -> "${secondsAgo / 60}m"
        else -> "${secondsAgo / 3600}h"
    }
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = cs.secondaryContainer),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onRetry),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Last synced $timeText ago",
                color = cs.onSecondaryContainer,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.weight(1f),
            )
            Text(
                "Refresh",
                color = cs.onSecondaryContainer,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            )
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

private val dateFormatter = SimpleDateFormat("EEEE, d MMM", Locale.getDefault())
private val isoFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
private val dayLabelOut = SimpleDateFormat("EEE", Locale.getDefault())
private val dayLabelIn = SimpleDateFormat("yyyy-MM-dd", Locale.US)

private fun greetingForTimeOfDay(): String {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return when (hour) {
        in 5..11 -> "Good morning,"
        in 12..16 -> "Good afternoon,"
        in 17..20 -> "Good evening,"
        else -> "Hello,"
    }
}

private fun formatDuration(sec: Int): String {
    if (sec <= 0) return "—"
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return when {
        h > 0 -> "${h}h ${m}m"
        m > 0 -> "${m}m"
        else -> "${s}s"
    }
}

private fun parseIsoMs(iso: String): Long? = runCatching {
    isoFormatter.parse(iso.substring(0, 19))?.time
}.getOrNull()

private fun labelForDate(iso: String): String {
    val cal = Calendar.getInstance()
    cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
    cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
    val todayIso = dayLabelIn.format(cal.time)
    return if (iso == todayIso) "Today" else runCatching {
        dayLabelOut.format(dayLabelIn.parse(iso)!!)
    }.getOrDefault(iso.takeLast(2))
}
