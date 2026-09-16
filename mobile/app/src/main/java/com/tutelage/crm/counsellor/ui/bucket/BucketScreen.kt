@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.bucket

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.School
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.leads.BucketLeadDto

// Bucket leads stay masked regardless of PhoneVisibility, but the leading "+" of
// an international number is kept so it's still identifiable at a glance.
private fun maskedPhone(value: String): String {
    val trimmed = value.trim()
    val plus = if (trimmed.startsWith("+")) "+" else ""
    val digits = trimmed.filter { it.isDigit() }
    return if (digits.length > 5) plus + digits.dropLast(5) + "*****" else plus + "*****"
}

@Composable
fun BucketScreen(onOpenLead: (Long) -> Unit, vm: BucketViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it) } }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Lead Bucket", fontWeight = FontWeight.Bold)
                        Text(state.total.toString() + " unassigned leads", style = MaterialTheme.typography.labelSmall)
                    }
                },
                actions = { IconButton(onClick = vm::refresh) { Icon(Icons.Default.Refresh, "Refresh") } },
            )
        },
        bottomBar = {
            if (state.selected.isNotEmpty()) {
                Surface(shadowElevation = 10.dp) {
                    Button(
                        onClick = vm::claimSelected,
                        enabled = !state.claiming,
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                    ) {
                        if (state.claiming) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary)
                        } else {
                            Icon(Icons.Default.PersonAdd, null)
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(if (state.claiming) "Assigning…" else "Assign " + state.selected.size + " to me")
                    }
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = state.query,
                onValueChange = vm::setQuery,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                singleLine = true,
                placeholder = { Text("Search name, email, or mobile") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilterTab("Unassigned", !state.flagMode) { vm.setFlagMode(false) }
                FilterTab("Flagged", state.flagMode) { vm.setFlagMode(true) }
                AssistChip(
                    onClick = vm::toggleFilters,
                    label = { Text(if (state.filtersExpanded) "Hide filters" else "Filters") },
                    leadingIcon = { Icon(Icons.Default.FilterList, null, Modifier.size(18.dp)) },
                )
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Leads per page", style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.width(8.dp))
                var expanded by remember { mutableStateOf(false) }
                Box {
                    OutlinedButton(onClick = { expanded = true }, contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) {
                        Text(state.pageSize.toString())
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        BUCKET_PAGE_SIZES.forEach { size ->
                            DropdownMenuItem(text = { Text(size.toString() + " leads") }, onClick = { expanded = false; vm.setPageSize(size) })
                        }
                    }
                }
                Spacer(Modifier.weight(1f))
                Checkbox(
                    checked = state.rows.isNotEmpty() && state.rows.all { it.id in state.selected },
                    onCheckedChange = { vm.toggleAll() },
                )
                Text("Select all", style = MaterialTheme.typography.labelMedium)
            }
            if (state.filtersExpanded) {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        SelectFilter("Website", state.website, state.websites, vm::setWebsite, Modifier.weight(1f))
                        SelectFilter("Source", state.source, state.sources, vm::setSource, Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        SelectFilter("Event / campaign", state.event, state.events, vm::setEvent, Modifier.weight(1f))
                        Spacer(Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        SmallFilter("From (YYYY-MM-DD)", state.fromDate, vm::setFromDate, Modifier.weight(1f))
                        SmallFilter("To (YYYY-MM-DD)", state.toDate, vm::setToDate, Modifier.weight(1f))
                    }
                    TextButton(onClick = vm::clearFilters) { Text("Clear all filters") }
                    HorizontalDivider()
                }
            }
            if (state.refreshing) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
            when {
                state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                state.rows.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Inbox, null, Modifier.size(54.dp))
                        Text("No matching leads", fontWeight = FontWeight.Bold)
                        Text("Try clearing filters or search.")
                    }
                }
                else -> {
                    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 8.dp)) {
                        items(state.rows, key = { it.id }) { lead ->
                            BucketRow(lead, lead.id in state.selected, { vm.toggle(lead.id) }, { onOpenLead(lead.id) })
                        }
                    }
                    PageControls(state.page, state.totalPages, vm::previousPage, vm::nextPage)
                }
            }
        }
    }
}

@Composable
private fun FilterTab(label: String, selected: Boolean, onClick: () -> Unit) =
    FilterChip(selected = selected, onClick = onClick, label = { Text(label) })

@Composable
private fun SelectFilter(label: String, value: String, options: List<String>, onChange: (String) -> Unit, modifier: Modifier) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(if (value.isBlank()) label else value, maxLines = 1)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text("All") }, onClick = { open = false; onChange("") })
            options.forEach { option ->
                DropdownMenuItem(text = { Text(option) }, onClick = { open = false; onChange(option) })
            }
        }
    }
}

@Composable
private fun SmallFilter(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier) =
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        modifier = modifier.padding(vertical = 3.dp),
        textStyle = MaterialTheme.typography.bodySmall,
    )

@Composable
private fun PageControls(page: Int, totalPages: Int, previous: () -> Unit, next: () -> Unit) =
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        IconButton(onClick = previous, enabled = page > 1) { Icon(Icons.Default.ChevronLeft, "Previous page") }
        Text("Page " + page + " of " + totalPages, fontWeight = FontWeight.SemiBold)
        IconButton(onClick = next, enabled = page < totalPages) { Icon(Icons.Default.ChevronRight, "Next page") }
    }

// ─── Bucket lead row — colorful + informative ──────────────────────────────
//
// The old version was a flat, monochrome list item (name + two gray lines).
// This mirrors the styling used in the main leads list: a soft pastel avatar,
// color-coded website/source pills, and icon-labeled city/course rows so a
// counsellor can tell leads apart at a glance while triaging the bucket.

private val BUCKET_TAG_PALETTE = listOf(
    Color(0xFFE0E7FF) to Color(0xFF4F46E5), // indigo
    Color(0xFFE0F2FE) to Color(0xFF0284C7), // sky
    Color(0xFFD1FAE5) to Color(0xFF059669), // emerald
    Color(0xFFFEF3C7) to Color(0xFFB45309), // amber
    Color(0xFFFCE7F3) to Color(0xFFBE185D), // pink
    Color(0xFFEDE9FE) to Color(0xFF7C3AED), // violet
    Color(0xFFCCFBF1) to Color(0xFF0F766E), // teal
)

private fun tagColorsFor(label: String): Pair<Color, Color> =
    BUCKET_TAG_PALETTE[label.hashCode().let { if (it < 0) -it else it } % BUCKET_TAG_PALETTE.size]

@Composable
private fun TagChip(icon: ImageVector, label: String) {
    val (bg, fg) = tagColorsFor(label)
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        ) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(4.dp))
            Text(
                label,
                color = fg,
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun BucketRow(lead: BucketLeadDto, selected: Boolean, onSelect: () -> Unit, onOpen: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val isFlagged = (lead.flagRcv ?: 0) == 1 || (lead.flagSend ?: 0) == 1
    Card(
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isFlagged) cs.errorContainer.copy(alpha = 0.35f) else cs.surface,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 5.dp)
            .clickable(onClick = onOpen),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            Checkbox(selected, onCheckedChange = { onSelect() })
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        lead.name.orEmpty().ifBlank { "Unnamed lead" },
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (isFlagged) {
                        Spacer(Modifier.width(6.dp))
                        Icon(
                            Icons.Default.Flag,
                            contentDescription = "Flagged",
                            tint = Color(0xFFEF4444),
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
                lead.mobile?.takeIf { it.isNotBlank() }?.let {
                    Text(maskedPhone(it), style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                }
                lead.email?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant, maxLines = 1)
                }

                val metaRows = listOfNotNull(
                    listOfNotNull(lead.city, lead.state).joinToString(", ").takeIf { it.isNotBlank() }?.let { Icons.Outlined.Place to it },
                    lead.intrestedCourse?.takeIf { it.isNotBlank() }?.let { Icons.Outlined.School to it },
                )
                if (metaRows.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        metaRows.forEach { (icon, label) ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(icon, contentDescription = null, tint = cs.onSurfaceVariant, modifier = Modifier.size(13.dp))
                                Spacer(Modifier.width(5.dp))
                                Text(label, style = MaterialTheme.typography.labelSmall, color = cs.onSurfaceVariant, maxLines = 1)
                            }
                        }
                    }
                }

                val tags = listOfNotNull(
                    lead.website?.takeIf { it.isNotBlank() }?.let { Icons.Outlined.Language to it },
                    lead.source?.takeIf { it.isNotBlank() }?.let { Icons.Outlined.Campaign to it },
                )
                if (tags.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        tags.forEach { (icon, label) -> TagChip(icon, label) }
                    }
                }
            }
        }
    }
}
