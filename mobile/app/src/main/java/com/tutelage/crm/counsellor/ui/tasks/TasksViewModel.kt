package com.tutelage.crm.counsellor.ui.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.leadwork.LeadWorkRepository
import com.tutelage.crm.counsellor.data.leadwork.TaskBatchDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import com.tutelage.crm.counsellor.util.AppForeground

data class TasksUiState(
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
    /** Every batch the server returned, across all days. */
    val batches: List<TaskBatchDto> = emptyList(),
    /** Day currently being viewed, "YYYY-MM-DD". Defaults to today. */
    val selectedDate: String = today(),
) {
    /** Distinct work-dates that actually have tasks, newest first, always including today. */
    val availableDates: List<String>
        get() = (batches.mapNotNull { it.workDateLabel } + today()).distinct().sortedDescending()

    /**
     * Tasks for the selected day — and ONLY that day.
     *
     * Unfinished work used to be dragged forward onto today, which turned
     * "today" into a pile of every open day at once and lost which day a task
     * actually belonged to. A task now stays on the day it was assigned for;
     * the day strip is how you go back and finish it. Mirrors the web's rule
     * in LeadCallingTasks.tsx.
     */
    val visibleBatches: List<TaskBatchDto>
        get() = batches.filter { it.workDateLabel == selectedDate }

    val onSelectedDay: List<TaskBatchDto>
        get() = visibleBatches

    /** Days that still have unfinished tasks — the strip flags them so an
     *  earlier day left half-done is still findable now that nothing rolls
     *  forward on its own. */
    val unfinishedDates: Set<String>
        get() = batches.filter { it.state != "COMPLETED" }.mapNotNull { it.workDateLabel }.toSet()

    /** Open tasks dated BEFORE the day in view. Nothing carries itself forward
     *  any more, so an empty day has to say out loud that earlier work is still
     *  waiting — otherwise "Nothing for today" reads as "nothing to do". */
    val unfinishedEarlier: Int
        get() = batches.count { it.state != "COMPLETED" && (it.workDateLabel ?: "") < selectedDate }

    /** Still to do on the selected day. */
    val pendingOnDay: List<TaskBatchDto>
        get() = onSelectedDay.filter { it.state != "COMPLETED" }

    /**
     * Finished on the selected day. Kept on screen permanently rather than
     * disappearing once done — a counsellor needs to be able to look back at
     * what they actually got through on any given day.
     */
    val completedOnDay: List<TaskBatchDto>
        get() = onSelectedDay.filter { it.state == "COMPLETED" }
}

private fun today(): String = java.time.LocalDate.now().toString()

@HiltViewModel
class TasksViewModel @Inject constructor(
    private val repository: LeadWorkRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(TasksUiState())
    val state: StateFlow<TasksUiState> = _state.asStateFlow()

    private var pollingJob: Job? = null

    init {
        refresh(showSpinner = true)
        pollingJob = viewModelScope.launch {
            AppForeground.pollWhileForeground(30_000) { refresh(showSpinner = false) }
        }
    }

    override fun onCleared() {
        pollingJob?.cancel()
        super.onCleared()
    }

    fun refresh() = refresh(showSpinner = false)

    fun selectDate(date: String) = _state.update { it.copy(selectedDate = date) }

    private fun refresh(showSpinner: Boolean) {
        val s = _state.value
        if (s.refreshing) return
        _state.update {
            it.copy(
                loading = showSpinner && it.batches.isEmpty(),
                refreshing = true,
                error = null,
            )
        }
        viewModelScope.launch {
            runCatching { repository.batches() }
                .onSuccess { batches ->
                    // Open tasks first (READY/IN_PROGRESS), most-pending first;
                    // completed tasks sink to the bottom — mirrors the web's
                    // "open tasks first" ordering in LeadCallingTasks.
                    val ordered = batches.sortedWith(
                        compareBy(
                            { it.state == "COMPLETED" },
                            { -it.remaining },
                        ),
                    )
                    _state.update {
                        it.copy(loading = false, refreshing = false, batches = ordered)
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            error = e.message?.takeIf { m -> m.isNotBlank() } ?: "Couldn't load tasks",
                        )
                    }
                }
        }
    }
}
