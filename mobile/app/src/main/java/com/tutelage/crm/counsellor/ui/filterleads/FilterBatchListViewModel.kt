package com.tutelage.crm.counsellor.ui.filterleads

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.staging.FilterLeadsRepository
import com.tutelage.crm.counsellor.data.staging.StagingBatchDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FilterBatchListUiState(
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: String? = null,
    val batches: List<StagingBatchDto> = emptyList(),
)

@HiltViewModel
class FilterBatchListViewModel @Inject constructor(
    private val repo: FilterLeadsRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(FilterBatchListUiState(loading = true))
    val state: StateFlow<FilterBatchListUiState> = _state.asStateFlow()

    init {
        load(showSpinner = true)
    }

    fun refresh() = load(showSpinner = false)

    private fun load(showSpinner: Boolean) {
        _state.update {
            it.copy(
                loading = showSpinner && it.batches.isEmpty(),
                refreshing = !showSpinner || it.batches.isNotEmpty(),
                error = null,
            )
        }
        viewModelScope.launch {
            runCatching { repo.batches() }
                .onSuccess { list ->
                    _state.update {
                        it.copy(loading = false, refreshing = false, batches = list, error = null)
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            loading = false,
                            refreshing = false,
                            error = e.message ?: "Couldn't load batches — will retry",
                        )
                    }
                }
        }
    }
}
