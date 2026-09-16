package com.tutelage.crm.counsellor.ui.leads

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.calls.CallEntity
import com.tutelage.crm.counsellor.data.calls.CallRepository
import com.tutelage.crm.counsellor.data.leads.FlagMessageDto
import com.tutelage.crm.counsellor.data.leads.FollowupCreateBody
import com.tutelage.crm.counsellor.data.leads.FollowupRecordDto
import com.tutelage.crm.counsellor.data.leads.DepartmentDto
import com.tutelage.crm.counsellor.data.leads.LeadCommentDto
import com.tutelage.crm.counsellor.data.leads.LeadConfigDto
import com.tutelage.crm.counsellor.data.leads.LeadDetailDto
import com.tutelage.crm.counsellor.data.leads.LeadNoteDto
import com.tutelage.crm.counsellor.data.leads.LeadPatchBody
import com.tutelage.crm.counsellor.data.leads.LeadRepository
import com.tutelage.crm.counsellor.data.leads.StatusHistoryDto
import com.tutelage.crm.counsellor.data.leads.TimelineEntryDto
import com.tutelage.crm.counsellor.util.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import com.tutelage.crm.counsellor.util.AppForeground

data class LeadDetailUiState(
    val loading: Boolean = true,
    val lead: LeadDetailDto? = null,
    val notes: List<LeadNoteDto> = emptyList(),
    val comments: List<LeadCommentDto> = emptyList(),
    val followups: List<FollowupRecordDto> = emptyList(),
    val timeline: List<TimelineEntryDto> = emptyList(),
    val history: List<StatusHistoryDto> = emptyList(),
    val flagMessages: List<FlagMessageDto> = emptyList(),
    val config: LeadConfigDto = LeadConfigDto(),
    val saving: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

@HiltViewModel
class LeadDetailViewModel @Inject constructor(
    private val repo: LeadRepository,
    private val callRepo: CallRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LeadDetailUiState())
    val state: StateFlow<LeadDetailUiState> = _state.asStateFlow()

    private var pollingJob: Job? = null
    private var currentLeadId: Long = 0L

    fun bind(leadId: Long) {
        if (currentLeadId == leadId && _state.value.lead != null) {
            refresh()
            return
        }
        // Binding a DIFFERENT lead. The in-flight load belongs to the previous
        // one and must be abandoned, for two reasons: its result would land on
        // this screen and render the wrong lead's notes, and — because refresh()
        // conflates onto a running job — leaving it active would make the call
        // below a no-op, stranding the new lead on its loading spinner forever.
        refreshJob?.cancel()
        refreshRequested = false
        currentLeadId = leadId
        _state.update { LeadDetailUiState(loading = true) }
        refresh()
    }

    /**
     * The in-flight load, plus a flag saying another was asked for while it ran.
     *
     * `refresh()` is called from bind(), the 60s poll, and after every mutation
     * (status, note, comment, followup, flag), so requests arrive in bursts.
     * Neither obvious strategy is right on its own: firing every call stacks
     * duplicate loads on the wire, and dropping calls that arrive mid-flight
     * loses the refresh a mutation just asked for, leaving the new note absent
     * until the next poll. Cancel-and-restart is worse still — a burst arriving
     * faster than the network completes starves every load.
     *
     * So conflate: at most one request in flight, and if any arrived while it
     * ran, do exactly one more pass afterwards. A burst of ten costs two
     * requests and always ends on fresh data.
     */
    private var refreshJob: Job? = null
    private var refreshRequested = false

    fun refresh() {
        val id = currentLeadId
        if (id == 0L) return
        if (refreshJob?.isActive == true) {
            refreshRequested = true
            return
        }
        refreshJob = viewModelScope.launch {
            do {
                refreshRequested = false
                runCatching { repo.fetchDetailBundle(id) }
                    .onSuccess { b ->
                        _state.update {
                            it.copy(
                                loading = false,
                                lead = b.lead,
                                notes = b.notes,
                                comments = b.comments,
                                followups = b.followups,
                                timeline = b.timeline,
                                history = b.history,
                                flagMessages = b.flags,
                                error = null,
                            )
                        }
                    }
                    .onFailure { e -> showLoadFailure(id, e) }
                loadConfigIfMissing()
            } while (refreshRequested && currentLeadId == id)
        }
    }

    /**
     * Fall back to the Room copy so a counsellor with no signal still sees the
     * lead's basics rather than an empty screen. Only the lead itself is cached
     * locally — notes, comments and the rest stay empty until connectivity is
     * back.
     */
    private suspend fun showLoadFailure(id: Long, e: Throwable) {
        val message = e.userMessage("Failed to load lead")
        if (_state.value.lead != null) {
            _state.update { it.copy(loading = false, error = message) }
            return
        }
        val cached = repo.byId(id)
        if (cached == null) {
            _state.update { it.copy(loading = false, error = message) }
            return
        }
        _state.update {
            it.copy(
                loading = false,
                lead = LeadDetailDto(
                    id = cached.id, name = cached.name, mobile = cached.mobile,
                    mobile2 = cached.mobile2, email = cached.email,
                    city = cached.city, state = cached.state,
                    leadStatus = cached.leadStatus, leadSubStatus = cached.leadSubStatus,
                    intrestedCourse = cached.intrestedCourse, updatedAt = cached.updatedAt,
                ),
                error = message,
            )
        }
    }

    /** Statuses/departments barely change; fetch once per screen, not per poll. */
    private suspend fun loadConfigIfMissing() {
        if (_state.value.config.statuses.isNotEmpty()) return
        runCatching { repo.leadConfig() }.onSuccess { v -> _state.update { it.copy(config = v) } }
    }

    fun startPolling() {
        stopPolling()
        pollingJob = viewModelScope.launch {
            // 60s, not 30s. Each tick re-fetches the detail plus six
            // auxiliary endpoints; a lead's notes and history do not change
            // twice a minute while one counsellor is looking at them. And not
            // at all when nobody is looking.
            AppForeground.pollWhileForeground(60_000) { refresh() }
        }
    }

    fun stopPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    /**
     * Update the lead's status / sub-status. Send `0L` as [subStatusId] to
     * explicitly clear the sub-status (e.g. when the user picked a new parent
     * status that doesn't have the previously-selected sub).
     *
     * Optimistically reflects the new label in `state.lead` so the UI updates
     * the instant the request fires — without waiting for the refresh round-trip
     * (which was the most common "I clicked Save and nothing happened"
     * complaint).
     */
    fun updateStatus(statusId: Long, subStatusId: Long?) {
        val id = currentLeadId
        if (id == 0L || _state.value.saving) return

        // Look up the human-readable labels from the loaded config so we can
        // optimistically render them.
        val cfg = _state.value.config
        val parent = cfg.statuses.firstOrNull { it.id == statusId }
        val sub = subStatusId?.takeIf { it != 0L }?.let { ssid ->
            parent?.subStatuses?.firstOrNull { it.id == ssid }
        }
        val optimisticLead = _state.value.lead?.copy(
            leadStatus = parent?.title ?: _state.value.lead?.leadStatus,
            leadSubStatus = sub?.subStatus,
            leadStatusId = statusId,
            leadSubStatusId = sub?.id,
        )

        _state.update {
            it.copy(
                saving = true,
                message = null,
                error = null,
                lead = optimisticLead ?: it.lead,
            )
        }

        // Send `0` to clear the sub-status — the backend (mobile.routes.ts
        // line ~718) treats 0 as the explicit "null" sentinel.
        val patchBody = LeadPatchBody(
            leadStatusId = statusId,
            leadSubStatusId = subStatusId ?: 0L,
        )
        viewModelScope.launch {
            runCatching { repo.patch(id, patchBody) }
                .onSuccess { updated ->
                    _state.update {
                        it.copy(
                            saving = false,
                            message = "Status updated",
                            lead = it.lead?.copy(
                                leadStatus = updated.leadStatus ?: it.lead.leadStatus,
                                leadSubStatus = updated.leadSubStatus,
                                leadStatusId = updated.leadStatusId,
                                leadSubStatusId = updated.leadSubStatusId,
                                updatedAt = updated.updatedAt ?: it.lead.updatedAt,
                            ),
                        )
                    }
                    refresh()
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            saving = false,
                            error = e.userMessage("Couldn't update status — try again"),
                        )
                    }
                    // Roll back optimistic change by re-fetching truth from server.
                    refresh()
                }
        }
    }

    fun addNote(text: String) {
        val id = currentLeadId
        val trimmed = text.trim()
        if (id == 0L || trimmed.isEmpty() || _state.value.saving) return
        _state.update { it.copy(saving = true, message = null) }
        viewModelScope.launch {
            runCatching { repo.addNote(id, trimmed) }
                .onSuccess { note ->
                    _state.update {
                        it.copy(
                            saving = false,
                            message = "Note added",
                            notes = listOf(note) + it.notes,
                        )
                    }
                    refresh()
                }
                .onFailure { e -> _state.update { it.copy(saving = false, error = e.userMessage("Couldn't add the note — try again")) } }
        }
    }

    fun addComment(text: String) {
        val id = currentLeadId
        val trimmed = text.trim()
        if (id == 0L || trimmed.isEmpty() || _state.value.saving) return
        _state.update { it.copy(saving = true, message = null) }
        viewModelScope.launch {
            runCatching { repo.addComment(id, trimmed) }
                .onSuccess { c ->
                    _state.update {
                        it.copy(
                            saving = false,
                            message = "Comment added",
                            comments = listOf(c) + it.comments,
                        )
                    }
                    refresh()
                }
                .onFailure { e -> _state.update { it.copy(saving = false, error = e.userMessage("Couldn't add the comment — try again")) } }
        }
    }

    fun addFollowup(body: FollowupCreateBody) {
        val id = currentLeadId
        if (id == 0L || _state.value.saving) return
        _state.update { it.copy(saving = true, message = null) }
        viewModelScope.launch {
            runCatching { repo.addFollowup(id, body) }
                .onSuccess {
                    _state.update { it.copy(saving = false, message = "Follow-up added") }
                    refresh()
                }
                .onFailure { e -> _state.update { it.copy(saving = false, error = e.userMessage("Couldn't add the follow-up — try again")) } }
        }
    }

    fun toggleFlag(message: String?) {
        val id = currentLeadId
        if (id == 0L || _state.value.saving) return
        _state.update { it.copy(saving = true) }
        viewModelScope.launch {
            runCatching { repo.toggleFlag(id, message) }
                .onSuccess { f ->
                    _state.update {
                        it.copy(
                            saving = false,
                            message = if (f.flagRcv == 1) "Lead flagged to admin" else "Flag cleared",
                            lead = it.lead?.copy(flagRcv = f.flagRcv, flagSend = f.flagSend),
                        )
                    }
                    refresh()
                }
                .onFailure { e -> _state.update { it.copy(saving = false, error = e.userMessage("Couldn't update the flag — try again")) } }
        }
    }

    fun clearMessage() = _state.update { it.copy(message = null, error = null) }

    override fun onCleared() {
        stopPolling()
        super.onCleared()
    }

    fun callsForLead(leadId: Long): Flow<List<CallEntity>> = callRepo.observeByLead(leadId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun beginOutgoingCall(leadId: Long, phone: String): String {
        val deviceCallId = "out_${System.currentTimeMillis()}_${UUID.randomUUID()}"
        val now = System.currentTimeMillis()
        viewModelScope.launch {
            callRepo.savePending(
                CallEntity(
                    deviceCallId = deviceCallId,
                    leadId = leadId,
                    phoneNumber = phone,
                    direction = "OUTGOING",
                    status = "RINGING",
                    startedAt = now,
                    source = "IN_APP",
                )
            )
        }
        return deviceCallId
    }
}
