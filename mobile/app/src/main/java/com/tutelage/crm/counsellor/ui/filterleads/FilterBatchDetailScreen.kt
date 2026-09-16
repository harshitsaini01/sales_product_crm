@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui.filterleads

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowRight
import androidx.compose.material.icons.outlined.LocationCity
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PhoneDisabled
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.tutelage.crm.counsellor.data.staging.StagingItemDto
import com.tutelage.crm.counsellor.data.staging.StagingStatus
import com.tutelage.crm.counsellor.util.maskPhone

@Composable
fun FilterBatchDetailScreen(
    batchId: Long,
    onBack: () -> Unit,
    onOpenLead: (Long) -> Unit,
    vm: FilterBatchDetailViewModel = hiltViewModel(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val cs = MaterialTheme.colorScheme

    LaunchedEffect(batchId) { vm.bind(batchId) }

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

    // ── Calling ────────────────────────────────────────────────────────────
    var pendingPhone by remember { mutableStateOf<String?>(null) }
    // Guard every external launch: a device with no dialer / SMS app / WhatsApp
    // throws ActivityNotFoundException (and ACTION_CALL can throw
    // SecurityException if the permission is revoked mid-flight) — show a toast
    // instead of crashing the screen.
    fun safeStart(intent: Intent, failMsg: String) {
        runCatching { context.startActivity(intent) }
            .onFailure {
                android.widget.Toast.makeText(context, failMsg, android.widget.Toast.LENGTH_SHORT).show()
            }
    }
    fun placeCall(phone: String) {
        safeStart(
            Intent(Intent.ACTION_CALL, Uri.parse("tel:$phone")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            "No phone app available",
        )
    }
    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val phone = pendingPhone
        pendingPhone = null
        if (phone != null) {
            if (granted) placeCall(phone)
            else safeStart(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")), "No phone app available")
        }
    }
    fun requestCall(phone: String) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE)
            == PackageManager.PERMISSION_GRANTED
        ) {
            placeCall(phone)
        } else {
            pendingPhone = phone
            permLauncher.launch(Manifest.permission.CALL_PHONE)
        }
    }
    fun openSms(phone: String) =
        safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("sms:$phone")), "No SMS app available")
    fun openWhatsApp(phone: String) {
        val digits = phone.filter { it.isDigit() }
        safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")), "WhatsApp not available")
    }

    // ── Derived list ─────────────────────────────────────────────────────────
    val counts = remember(state.items) {
        var pending = 0; var verified = 0; var rejected = 0
        var callNotAnswered = 0; var seeded = 0
        for (i in state.items) {
            if (i.seeded) seeded++
            // "Pending" excludes call-not-answered items so they don't show up
            // in both buckets at once — matches the web tab semantics.
            when {
                i.verified == true -> verified++
                i.verified == false -> rejected++
                i.callNotAnswered -> callNotAnswered++
                else -> pending++
            }
        }
        Counts(state.items.size, pending, verified, rejected, callNotAnswered, seeded)
    }
    // Distinct State / City options sourced from this batch only — each folder
    // shows its own geography. Sorted case-insensitively so the dropdown reads
    // naturally regardless of how the upload normalized casing.
    val stateOptions = remember(state.items) {
        state.items.mapNotNull { it.state?.trim()?.takeIf { s -> s.isNotEmpty() } }
            .distinct().sortedBy { it.lowercase() }
    }
    val cityOptions = remember(state.items) {
        state.items.mapNotNull { it.city?.trim()?.takeIf { s -> s.isNotEmpty() } }
            .distinct().sortedBy { it.lowercase() }
    }
    val filtered = remember(
        state.items, state.filter, state.search,
        state.stateFilter, state.cityFilter, state.noCommentsOnly,
    ) {
        val q = state.search.trim().lowercase()
        val sf = state.stateFilter
        val cf = state.cityFilter
        state.items.filter { it ->
            val passesTab = when (state.filter) {
                ItemFilter.ALL -> true
                ItemFilter.PENDING -> it.verified == null && !it.callNotAnswered
                ItemFilter.VERIFIED -> it.verified == true
                ItemFilter.REJECTED -> it.verified == false
                ItemFilter.CALL_NOT_ANSWERED -> it.callNotAnswered
                ItemFilter.SEEDED -> it.seeded
            }
            if (!passesTab) return@filter false
            if (sf.isNotEmpty() && (it.state?.trim() ?: "") !in sf) return@filter false
            if (cf.isNotEmpty() && (it.city?.trim() ?: "") !in cf) return@filter false
            if (state.noCommentsOnly && !it.comments.isNullOrBlank()) return@filter false
            if (q.isEmpty()) return@filter true
            val hay = "${it.name.orEmpty()} ${it.email.orEmpty()} ${it.phone.orEmpty()}".lowercase()
            hay.contains(q)
        }
    }
    val totalPages = remember(filtered.size, state.pageSize) {
        if (filtered.isEmpty() || state.pageSize <= 0) 1
        else ((filtered.size + state.pageSize - 1) / state.pageSize)
    }
    val pagedItems = remember(filtered, state.page, state.pageSize) {
        val from = ((state.page - 1) * state.pageSize).coerceIn(0, filtered.size)
        val to = (state.page * state.pageSize).coerceIn(0, filtered.size)
        filtered.subList(from, to)
    }

    Scaffold(
        containerColor = cs.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(state.batch?.name ?: "Batch", maxLines = 1)
                        state.batch?.fileName?.takeIf { it.isNotBlank() }?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.labelSmall,
                                color = cs.onPrimary.copy(alpha = 0.8f),
                                maxLines = 1,
                            )
                        }
                    }
                },
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
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
        ) {
            item(key = "__tabs__") {
                Tabs(filter = state.filter, counts = counts, onSelect = vm::setFilter)
            }
            item(key = "__search__") {
                SearchBox(value = state.search, onChange = vm::setSearch)
            }
            item(key = "__geo__") {
                GeoFilterRow(
                    stateOptions = stateOptions,
                    cityOptions = cityOptions,
                    selectedStates = state.stateFilter,
                    selectedCities = state.cityFilter,
                    onStates = vm::setStateFilter,
                    onCities = vm::setCityFilter,
                )
            }
            item(key = "__extra_filters__") {
                ExtraFiltersRow(
                    noCommentsOnly = state.noCommentsOnly,
                    onToggleNoComments = vm::toggleNoCommentsOnly,
                )
            }
            // Active-filter chips — one chip per selected state/city + a chip
            // for "no comments" when on. Each has × to remove just that one.
            // Whole row only renders when at least one filter is active so
            // the page doesn't grow empty whitespace.
            if (state.stateFilter.isNotEmpty() || state.cityFilter.isNotEmpty() || state.noCommentsOnly) {
                item(key = "__active_chips__") {
                    ActiveFilterChips(
                        states = state.stateFilter,
                        cities = state.cityFilter,
                        noCommentsOnly = state.noCommentsOnly,
                        onRemoveState = vm::removeStateFilter,
                        onRemoveCity = vm::removeCityFilter,
                        onClearNoComments = vm::toggleNoCommentsOnly,
                        onClearAll = vm::clearAllFilters,
                    )
                }
            }

            when {
                state.loading -> item(key = "__loading__") {
                    Box(
                        modifier = Modifier.fillMaxWidth().height(200.dp),
                        contentAlignment = Alignment.Center,
                    ) { androidx.compose.material3.CircularProgressIndicator() }
                }

                filtered.isEmpty() -> item(key = "__empty__") {
                    EmptyItems(hasItems = state.items.isNotEmpty(), error = state.error)
                }

                else -> {
                    item(key = "__count__") {
                        val start = if (filtered.isEmpty()) 0 else (state.page - 1) * state.pageSize + 1
                        val end = minOf(state.page * state.pageSize, filtered.size)
                        Text(
                            "Showing $start–$end of ${filtered.size} lead${if (filtered.size == 1) "" else "s"}",
                            style = MaterialTheme.typography.labelSmall,
                            color = cs.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                        )
                    }
                    item(key = "__pager_top__") {
                        FilterPaginationBar(
                            page = state.page,
                            totalPages = totalPages,
                            pageSize = state.pageSize,
                            onPageSize = vm::setPageSize,
                            onFirst = { vm.firstPage(totalPages) },
                            onPrev = { vm.prevPage(totalPages) },
                            onNext = { vm.nextPage(totalPages) },
                            onLast = { vm.lastPage(totalPages) },
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                    items(items = pagedItems, key = { it.id }) { item ->
                        ItemCard(
                            item = item,
                            saving = item.id in state.savingItemIds,
                            onCall = { requestCall(it) },
                            onSms = { openSms(it) },
                            onWhatsApp = { openWhatsApp(it) },
                            onSetStatus = { target -> vm.setStatus(item, target) },
                            onSaveComment = { text -> vm.saveComment(item, text) },
                            onOpenLead = onOpenLead,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                        )
                    }
                    if (totalPages > 1) {
                        item(key = "__pager_bottom__") {
                            FilterPaginationBar(
                                page = state.page,
                                totalPages = totalPages,
                                pageSize = state.pageSize,
                                onPageSize = vm::setPageSize,
                                onFirst = { vm.firstPage(totalPages) },
                                onPrev = { vm.prevPage(totalPages) },
                                onNext = { vm.nextPage(totalPages) },
                                onLast = { vm.lastPage(totalPages) },
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

private data class Counts(
    val all: Int,
    val pending: Int,
    val verified: Int,
    val rejected: Int,
    val callNotAnswered: Int,
    val seeded: Int,
)

@Composable
private fun Tabs(filter: ItemFilter, counts: Counts, onSelect: (ItemFilter) -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ItemFilter.values().forEach { f ->
            val count = when (f) {
                ItemFilter.ALL -> counts.all
                ItemFilter.PENDING -> counts.pending
                ItemFilter.VERIFIED -> counts.verified
                ItemFilter.REJECTED -> counts.rejected
                ItemFilter.CALL_NOT_ANSWERED -> counts.callNotAnswered
                ItemFilter.SEEDED -> counts.seeded
            }
            val selected = filter == f
            Surface(
                shape = RoundedCornerShape(50),
                color = if (selected) cs.primary else cs.surfaceVariant,
                modifier = Modifier.clickable { onSelect(f) },
            ) {
                Text(
                    "${f.label} ($count)",
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

@Composable
private fun SearchBox(value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text("Search name, email, phone…", style = MaterialTheme.typography.bodyMedium) },
        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
        trailingIcon = {
            if (value.isNotEmpty()) {
                Icon(
                    Icons.Outlined.Clear,
                    contentDescription = "Clear",
                    modifier = Modifier.clickable { onChange("") },
                )
            }
        },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Search),
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
    )
}

// State + City multi-select dropdowns. Options are derived from this batch's
// own items by the caller, so each folder only surfaces its own geography.
// Tapping the field opens a searchable picker; tick/untick options to build
// up the filter. Mirrors the web FilterLeadsBatch MultiSelectDropdown.
@Composable
private fun GeoFilterRow(
    stateOptions: List<String>,
    cityOptions: List<String>,
    selectedStates: Set<String>,
    selectedCities: Set<String>,
    onStates: (Set<String>) -> Unit,
    onCities: (Set<String>) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilterDropdown(
            label = "State",
            icon = Icons.Outlined.Place,
            selected = selectedStates,
            options = stateOptions,
            allLabel = if (stateOptions.isEmpty()) "No states in this folder"
                       else "All states (${stateOptions.size})",
            onSelect = onStates,
            modifier = Modifier.weight(1f),
        )
        FilterDropdown(
            label = "City",
            icon = Icons.Outlined.LocationCity,
            selected = selectedCities,
            options = cityOptions,
            allLabel = if (cityOptions.isEmpty()) "No cities in this folder"
                       else "All cities (${cityOptions.size})",
            onSelect = onCities,
            modifier = Modifier.weight(1f),
        )
    }
}

// "No comments" toggle pill — sits under the geo filters so it's discoverable
// next to State/City but doesn't clutter the dropdown picker. Tap to toggle;
// when active, only items with a blank/null counsellor comment match.
@Composable
private fun ExtraFiltersRow(
    noCommentsOnly: Boolean,
    onToggleNoComments: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            shape = RoundedCornerShape(999.dp),
            color = if (noCommentsOnly) cs.primary else cs.surfaceVariant,
            border = androidx.compose.foundation.BorderStroke(
                1.dp,
                if (noCommentsOnly) cs.primary else cs.outlineVariant,
            ),
            modifier = Modifier.clickable(onClick = onToggleNoComments),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Outlined.Chat,
                    contentDescription = null,
                    tint = if (noCommentsOnly) cs.onPrimary else cs.onSurfaceVariant,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    "No comments",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontWeight = if (noCommentsOnly) FontWeight.SemiBold else FontWeight.Medium,
                    ),
                    color = if (noCommentsOnly) cs.onPrimary else cs.onSurfaceVariant,
                )
                if (noCommentsOnly) {
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = null,
                        tint = cs.onPrimary,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
        }
    }
}

// Active filter chips — one per selected state/city + one for "no comments"
// when on. Tap × on a chip to drop just that one; "Clear all" wipes all at
// once. Same pattern as the web's Active filters bar.
@Composable
private fun ActiveFilterChips(
    states: Set<String>,
    cities: Set<String>,
    noCommentsOnly: Boolean,
    onRemoveState: (String) -> Unit,
    onRemoveCity: (String) -> Unit,
    onClearNoComments: () -> Unit,
    onClearAll: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val total = states.size + cities.size + (if (noCommentsOnly) 1 else 0)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(cs.surfaceVariant.copy(alpha = 0.4f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Active filters · $total",
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                color = cs.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onClearAll) {
                Text("Clear all", style = MaterialTheme.typography.labelMedium)
            }
        }
        // Horizontally-scrollable chip strip — long state names + many cities
        // can easily exceed one screen width, and a wrap would push the lead
        // cards way down.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            states.forEach { s ->
                FilterChip(label = "State: $s", onRemove = { onRemoveState(s) })
            }
            cities.forEach { c ->
                FilterChip(label = "City: $c", onRemove = { onRemoveCity(c) })
            }
            if (noCommentsOnly) {
                FilterChip(label = "No comments", onRemove = onClearNoComments)
            }
        }
    }
}

@Composable
private fun FilterChip(label: String, onRemove: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = cs.primary.copy(alpha = 0.12f),
        border = androidx.compose.foundation.BorderStroke(1.dp, cs.primary.copy(alpha = 0.35f)),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                color = cs.primary,
                maxLines = 1,
            )
            Spacer(Modifier.width(4.dp))
            Surface(
                shape = CircleShape,
                color = cs.primary.copy(alpha = 0.18f),
                modifier = Modifier
                    .size(20.dp)
                    .clickable(onClick = onRemove),
            ) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Remove $label",
                        tint = cs.primary,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun FilterDropdown(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Set<String>,
    options: List<String>,
    allLabel: String,
    onSelect: (Set<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    var pickerOpen by remember { mutableStateOf(false) }
    val enabled = options.isNotEmpty()
    val hasSelection = selected.isNotEmpty()
    // Trigger label: "Maharashtra" for one pick, "Maharashtra" + "+3" for many,
    // "All states (39)" placeholder otherwise. The overflow count is kept OUT of
    // this string and rendered as its own element below — as part of the string
    // it sat at the end of a maxLines=1 Text and was the first thing clipped, so
    // a chip with 4 selections looked identical to one with 1.
    val triggerText = when {
        selected.isNotEmpty() -> selected.first()
        else -> allLabel
    }
    val extraCount = (selected.size - 1).coerceAtLeast(0)

    Surface(
        shape = RoundedCornerShape(12.dp),
        color = cs.surfaceVariant.copy(alpha = if (enabled) 1f else 0.5f),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (hasSelection) cs.primary else cs.outlineVariant,
        ),
        modifier = modifier
            .fillMaxWidth()
            .clickable(enabled = enabled) { pickerOpen = true },
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
        ) {
            Icon(icon, contentDescription = null, tint = cs.outline, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    label,
                    style = MaterialTheme.typography.labelSmall,
                    color = cs.outline,
                    maxLines = 1,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Name is weighted with fill = false, so the "+N" chip beside it
                    // is measured at its natural size first and always stays visible.
                    Text(
                        triggerText,
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontWeight = if (hasSelection) FontWeight.SemiBold else FontWeight.Normal,
                        ),
                        color = if (hasSelection) cs.onSurface else cs.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (extraCount > 0) {
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "+$extraCount",
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                            color = cs.primary,
                            maxLines = 1,
                            softWrap = false,
                        )
                    }
                }
}
            Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = cs.outline)
        }
    }

    if (pickerOpen) {
        FilterPickerDialog(
            title = label,
            options = options,
            initialSelected = selected,
            onApply = { onSelect(it); pickerOpen = false },
            onDismiss = { pickerOpen = false },
        )
    }
}

// Searchable multi-select picker. Capped at ~70% of screen height so it
// never covers the entire page; option list is a LazyColumn so 39+ cities
// scroll smoothly. Selection state is local to the dialog and committed on
// "Done" — that way an accidental tap doesn't immediately re-filter the
// underlying list mid-edit.
@Composable
private fun FilterPickerDialog(
    title: String,
    options: List<String>,
    initialSelected: Set<String>,
    onApply: (Set<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    var query by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(initialSelected) }
    val filtered = remember(options, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) options else options.filter { it.lowercase().contains(q) }
    }
    val configuration = androidx.compose.ui.platform.LocalConfiguration.current
    val maxSheetHeight = (configuration.screenHeightDp * 0.7f).dp

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = cs.surface,
            tonalElevation = 6.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .heightIn(max = maxSheetHeight),
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 12.dp, top = 14.dp, bottom = 8.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Filter by $title",
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        )
                        Text(
                            if (working.isEmpty()) "Tap to pick one or more"
                            else "${working.size} selected",
                            style = MaterialTheme.typography.labelSmall,
                            color = cs.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = "Close")
                    }
                }
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search ${title.lowercase()}…") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    trailingIcon = {
                        if (query.isNotEmpty()) {
                            Icon(
                                Icons.Outlined.Clear,
                                contentDescription = "Clear",
                                modifier = Modifier.clickable { query = "" },
                            )
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                )

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f, fill = false)
                        .padding(top = 6.dp, bottom = 6.dp),
                ) {
                    items(items = filtered, key = { it }) { opt ->
                        PickerRow(
                            label = opt,
                            isSelected = opt in working,
                            onClick = {
                                working = if (opt in working) working - opt else working + opt
                            },
                        )
                    }
                    if (filtered.isEmpty()) {
                        item(key = "__empty__") {
                            Text(
                                if (query.isBlank()) "No options available"
                                else "No matches for \"$query\"",
                                style = MaterialTheme.typography.bodyMedium,
                                color = cs.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
                            )
                        }
                    }
                }

                // Footer — Clear / Done. "Clear" empties the working set so
                // pressing Done commits an empty selection (= "All"). Same
                // pattern as the web picker's clear-all link.
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    TextButton(
                        onClick = { working = emptySet() },
                        enabled = working.isNotEmpty(),
                    ) { Text("Clear") }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onDismiss) { Text("Cancel") }
                    TextButton(onClick = { onApply(working) }) {
                        Text("Done", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold))
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerRow(label: String, isSelected: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(if (isSelected) cs.primary.copy(alpha = 0.08f) else Color.Transparent)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        // Checkbox-style indicator — filled when selected, outlined when not.
        // Keeps the multi-select affordance obvious without needing the
        // material Checkbox component (which has its own padding rules that
        // don't match the row's compact density).
        Surface(
            shape = RoundedCornerShape(4.dp),
            color = if (isSelected) cs.primary else Color.Transparent,
            border = androidx.compose.foundation.BorderStroke(
                1.5.dp,
                if (isSelected) cs.primary else cs.outline,
            ),
            modifier = Modifier.size(18.dp),
        ) {
            if (isSelected) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = null,
                        tint = cs.onPrimary,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
        }
        Spacer(Modifier.width(12.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            ),
            color = if (isSelected) cs.primary else cs.onSurface,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ItemCard(
    item: StagingItemDto,
    saving: Boolean,
    onCall: (String) -> Unit,
    onSms: (String) -> Unit,
    onWhatsApp: (String) -> Unit,
    onSetStatus: (StagingStatus) -> Unit,
    onSaveComment: (String) -> Unit,
    onOpenLead: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    val status = when {
        item.seeded -> "seeded"
        item.verified == true -> "verified"
        item.verified == false -> "rejected"
        item.callNotAnswered -> "call_not_answered"
        else -> "pending"
    }
    val accent = when (status) {
        "seeded" -> Color(0xFF059669)
        "verified" -> Color(0xFF10B981)
        "rejected" -> Color(0xFFE11D48)
        "call_not_answered" -> Color(0xFFF59E0B)
        else -> cs.outlineVariant
    }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = cs.surface,
        border = androidx.compose.foundation.BorderStroke(1.5.dp, accent.copy(alpha = 0.5f)),
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header: name + status badge
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.name?.takeIf { it.isNotBlank() } ?: "(no name)",
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                )
                StatusBadge(status)
            }

            // Contact lines
            item.email?.takeIf { it.isNotBlank() }?.let { ContactLine(Icons.Outlined.Email, it) }
            item.phone?.takeIf { it.isNotBlank() }?.let { ContactLine(Icons.Outlined.Phone, maskPhone(it)) }

            // Call / SMS / WhatsApp — only when there's a number to dial
            item.phone?.takeIf { it.isDialable() }?.let { phone ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    ActionPill("Call", Icons.Default.Call, cs.primary, cs.onPrimary, Modifier.weight(1f)) { onCall(phone) }
                    ActionPill("SMS", Icons.Outlined.Sms, cs.secondaryContainer, cs.onSecondaryContainer, Modifier.weight(1f)) { onSms(phone) }
                    ActionPill("WhatsApp", Icons.AutoMirrored.Outlined.Chat, Color(0xFF25D366).copy(alpha = 0.15f), Color(0xFF1EA952), Modifier.weight(1f)) { onWhatsApp(phone) }
                }
            }

            // Alternate numbers — Mobile 2 / Mobile 3. Each shows the masked
            // number with its own Call / SMS / WhatsApp pills so the counsellor
            // can fall back without re-keying anything. Skipped when the field
            // is blank, "0", or fewer than 4 digits (junk imports).
            listOfNotNull(
                item.mobile2?.takeIf { it.isDialable() }?.let { "Mobile 2" to it },
                item.mobile3?.takeIf { it.isDialable() }?.let { "Mobile 3" to it },
            ).forEach { (label, number) ->
                AltNumberRow(
                    label = label,
                    masked = maskPhone(number),
                    onCall = { onCall(number) },
                    onSms = { onSms(number) },
                    onWhatsApp = { onWhatsApp(number) },
                )
            }

            // Extra profile fields
            DetailsGrid(item)

            // Verify / Not-Verified / Call N/A toggle (hidden once seeded).
            // All three are mutually exclusive — tapping the active one clears
            // back to pending; call-not-answered items stay out of the seed pool.
            if (!item.seeded) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    VerifyButton(
                        label = "Verified",
                        icon = if (item.verified == true) Icons.Default.CheckCircle else Icons.Outlined.CheckCircle,
                        active = item.verified == true,
                        activeColor = Color(0xFF059669),
                        enabled = !saving,
                        modifier = Modifier.weight(1f),
                    ) {
                        onSetStatus(if (item.verified == true) StagingStatus.PENDING else StagingStatus.VERIFIED)
                    }
                    VerifyButton(
                        label = "Not Verified",
                        icon = Icons.Outlined.Cancel,
                        active = item.verified == false,
                        activeColor = Color(0xFFE11D48),
                        enabled = !saving,
                        modifier = Modifier.weight(1f),
                    ) {
                        onSetStatus(if (item.verified == false) StagingStatus.PENDING else StagingStatus.REJECTED)
                    }
                    VerifyButton(
                        label = "Call N/A",
                        icon = Icons.Outlined.PhoneDisabled,
                        active = item.callNotAnswered,
                        activeColor = Color(0xFFF59E0B),
                        enabled = !saving,
                        modifier = Modifier.weight(1f),
                    ) {
                        onSetStatus(if (item.callNotAnswered) StagingStatus.PENDING else StagingStatus.CALL_NOT_ANSWERED)
                    }
                }
            }

            // Comment
            CommentSection(item = item, saving = saving, locked = item.seeded, onSave = onSaveComment)

            if (item.seeded && item.leadId != null) {
                Text(
                    "Open in CRM →",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = Color(0xFF059669),
                    modifier = Modifier.clickable { onOpenLead(item.leadId) },
                )
            }
        }
    }
}

@Composable
private fun StatusBadge(status: String) {
    val (bg, fg, label) = when (status) {
        "seeded" -> Triple(Color(0xFF059669), Color.White, "Seeded ✓")
        "verified" -> Triple(Color(0xFFD1FAE5), Color(0xFF065F46), "Verified")
        "rejected" -> Triple(Color(0xFFFEE2E2), Color(0xFF991B1B), "Not Verified")
        "call_not_answered" -> Triple(Color(0xFFFEF3C7), Color(0xFF92400E), "Call Not Answered")
        else -> Triple(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, "Pending")
    }
    Surface(shape = RoundedCornerShape(999.dp), color = bg) {
        Text(
            label,
            color = fg,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun ContactLine(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    val cs = MaterialTheme.colorScheme
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = cs.outline, modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = cs.onSurfaceVariant, maxLines = 1)
    }
}

@Composable
private fun ActionPill(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    container: Color,
    content: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = container,
        modifier = modifier.height(42.dp).clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(icon, contentDescription = label, tint = content, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(5.dp))
            Text(label, color = content, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

// A row for an alternate phone number — Mobile 2 / Mobile 3. Label + masked
// number on the left, Call / SMS / WhatsApp icon buttons on the right. Compact
// so it doesn't dominate the card the way the primary action row does.
@Composable
private fun AltNumberRow(
    label: String,
    masked: String,
    onCall: () -> Unit,
    onSms: () -> Unit,
    onWhatsApp: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = cs.onSurfaceVariant,
            )
            Text(
                masked,
                style = MaterialTheme.typography.bodyMedium,
                color = cs.onSurface,
                maxLines = 1,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            IconActionPill(Icons.Default.Call, "Call $label", cs.primary, cs.onPrimary, onCall)
            IconActionPill(Icons.Outlined.Sms, "SMS $label", cs.secondaryContainer, cs.onSecondaryContainer, onSms)
            IconActionPill(Icons.AutoMirrored.Outlined.Chat, "WhatsApp $label", Color(0xFF25D366).copy(alpha = 0.15f), Color(0xFF1EA952), onWhatsApp)
        }
    }
}

@Composable
private fun IconActionPill(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    container: Color,
    content: Color,
    onClick: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = container,
        modifier = Modifier.size(width = 38.dp, height = 34.dp).clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(icon, contentDescription = description, tint = content, modifier = Modifier.size(16.dp))
        }
    }
}

// A phone field is "dialable" only when it has at least 4 digits — guards
// against junk imports like "0" or empty strings.
private fun String.isDialable(): Boolean = count { it.isDigit() } >= 4

@Composable
private fun DetailsGrid(item: StagingItemDto) {
    val cs = MaterialTheme.colorScheme
    val rows = listOfNotNull(
        item.father?.nb()?.let { "Father" to it },
        item.mother?.nb()?.let { "Mother" to it },
        item.email2?.nb()?.let { "Email 2" to it },
        item.email3?.nb()?.let { "Email 3" to it },
        item.fatherMobile?.nb()?.let { "Father Mobile" to maskPhone(it) },
        item.motherMobile?.nb()?.let { "Mother Mobile" to maskPhone(it) },
        item.city?.nb()?.let { "City" to it },
        item.state?.nb()?.let { "State" to it },
        item.country?.nb()?.let { "Country" to it },
        item.pincode?.nb()?.let { "Pincode" to it },
        item.dob?.nb()?.let { "DOB" to it },
        item.gender?.nb()?.let { "Gender" to it },
        item.nationality?.nb()?.let { "Nationality" to it },
        item.intrestedCourse?.nb()?.let { "Course" to it },
        item.intrestedUniversity?.nb()?.let { "University" to it },
        item.event?.nb()?.let { "Event" to it },
        item.source?.nb()?.let { "Source" to it },
        item.leadType?.nb()?.let { "Lead Type" to it },
    )
    if (rows.isEmpty() && item.leadComment.isNullOrBlank()) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(cs.surfaceVariant.copy(alpha = 0.4f))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        rows.forEach { (k, v) ->
            Row(modifier = Modifier.fillMaxWidth()) {
                Text(k, style = MaterialTheme.typography.labelSmall, color = cs.outline, modifier = Modifier.weight(0.4f))
                Text(
                    v,
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
                    color = cs.onSurface,
                    modifier = Modifier.weight(0.6f),
                )
            }
        }
        item.leadComment?.nb()?.let {
            Text(
                "“$it”",
                style = MaterialTheme.typography.labelSmall,
                color = cs.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

@Composable
private fun VerifyButton(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    active: Boolean,
    activeColor: Color,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val container = if (active) activeColor else cs.surfaceVariant
    val content = if (active) Color.White else cs.onSurfaceVariant
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (enabled) container else container.copy(alpha = 0.5f),
        modifier = modifier.height(40.dp).clickable(enabled = enabled, onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, color = content, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

@Composable
private fun CommentSection(item: StagingItemDto, saving: Boolean, locked: Boolean, onSave: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var editing by remember(item.id) { mutableStateOf(false) }
    var text by remember(item.id) { mutableStateOf(item.comments.orEmpty()) }

    if (editing && !locked) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("Notes from the call…") },
                minLines = 2,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { text = item.comments.orEmpty(); editing = false }) { Text("Cancel") }
                TextButton(
                    enabled = !saving,
                    onClick = { onSave(text); editing = false },
                ) { Text("Save") }
            }
        }
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                item.comments?.nb()?.let {
                    Text("“$it”", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                }
            }
            if (!locked) {
                TextButton(onClick = { editing = true }) {
                    Text(if (item.comments.isNullOrBlank()) "+ Add comment" else "Edit comment")
                }
            }
        }
    }
}

@Composable
private fun FilterPaginationBar(
    page: Int,
    totalPages: Int,
    pageSize: Int,
    onPageSize: (Int) -> Unit,
    onFirst: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onLast: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val cs = MaterialTheme.colorScheme
    var sizeMenuOpen by remember { mutableStateOf(false) }
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
            // Page size selector
            Box {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = cs.surfaceVariant,
                    modifier = Modifier.clickable { sizeMenuOpen = true },
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "$pageSize / page",
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
                DropdownMenu(expanded = sizeMenuOpen, onDismissRequest = { sizeMenuOpen = false }) {
                    FILTER_PAGE_SIZES.forEach { size ->
                        DropdownMenuItem(
                            text = { Text("$size per page") },
                            onClick = { onPageSize(size); sizeMenuOpen = false },
                        )
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            // First
            FPagerBtn(Icons.Outlined.KeyboardDoubleArrowLeft, "First", page > 1, onFirst)
            // Prev
            FPagerBtn(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Prev", page > 1, onPrev)
            Text(
                "$page / ${totalPages.coerceAtLeast(1)}",
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                color = cs.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
            // Next
            FPagerBtn(Icons.AutoMirrored.Outlined.KeyboardArrowRight, "Next", page < totalPages, onNext)
            // Last
            FPagerBtn(Icons.Outlined.KeyboardDoubleArrowRight, "Last", page < totalPages, onLast)
        }
    }
}

@Composable
private fun FPagerBtn(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    enabled: Boolean,
    onClick: () -> Unit,
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
private fun EmptyItems(hasItems: Boolean, error: String?) {
    val cs = MaterialTheme.colorScheme
    Box(modifier = Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Inbox, contentDescription = null, tint = cs.outline, modifier = Modifier.size(40.dp))
            Spacer(Modifier.height(8.dp))
            Text(
                error ?: if (hasItems) "No leads match this filter" else "This batch has no leads",
                style = MaterialTheme.typography.bodyMedium,
                color = cs.onSurfaceVariant,
            )
        }
    }
}

/** Trim → null-if-blank helper, kept terse since it's used many times above. */
private fun String.nb(): String? = trim().ifBlank { null }
