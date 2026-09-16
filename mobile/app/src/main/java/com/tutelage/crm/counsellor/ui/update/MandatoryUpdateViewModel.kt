package com.tutelage.crm.counsellor.ui.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.release.AppReleaseDto
import com.tutelage.crm.counsellor.update.AppUpdater
import com.tutelage.crm.counsellor.update.UpdateAvailable
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import timber.log.Timber
import javax.inject.Inject
import com.tutelage.crm.counsellor.util.AppForeground

/**
 * Drives the app-wide mandatory-update gate mounted on MainScreen. Polls the
 * same AppUpdater singleton LeadList/Profile already check on entry, so this
 * just adds a periodic re-check so a mandatory push doesn't require the user
 * to navigate anywhere before the gate appears.
 */
@HiltViewModel
class MandatoryUpdateViewModel @Inject constructor(
    private val appUpdater: AppUpdater,
) : ViewModel() {

    val updateAvailable: StateFlow<UpdateAvailable?> = appUpdater.state
    val installError: StateFlow<String?> = appUpdater.installError

    // Owned by AppUpdater, not here. This used to be a local flag that was set on
    // tap and never cleared — on a non-dismissible gate that meant one failed
    // download bricked the app until the counsellor force-stopped it.
    val downloading: StateFlow<Boolean> = appUpdater.downloading

    init {
        viewModelScope.launch {
            AppForeground.pollWhileForeground(POLL_INTERVAL_MS, runImmediately = true) {
                runCatching { appUpdater.checkForUpdate() }
                    .onFailure { Timber.d(it, "[mandatory-update] check failed (ignored, will retry)") }
            }
        }
    }

    fun install(release: AppReleaseDto) {
        if (downloading.value) return
        runCatching { appUpdater.startDownload(release) }
            .onFailure { Timber.e(it, "[mandatory-update] startDownload failed") }
    }

    fun clearInstallError() = appUpdater.clearInstallError()

    companion object {
        // Was 60s. A mandatory release does not need one-minute detection —
        // it is a rare, planned event — and this ran forever, backgrounded
        // included, hitting /api/app-releases/latest 1,440 times a day per
        // counsellor to learn nothing.
        private const val POLL_INTERVAL_MS = 15 * 60_000L
    }
}
