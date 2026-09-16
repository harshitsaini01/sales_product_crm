package com.tutelage.crm.counsellor.ui.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.BuildConfig
import com.tutelage.crm.counsellor.data.auth.AuthApi
import com.tutelage.crm.counsellor.data.auth.AuthRepository
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.release.AppReleaseDto
import com.tutelage.crm.counsellor.update.AppUpdater
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProfileUiState(
    val name: String? = null,
    val email: String? = null,
    val mobile: String? = null,
    val role: String? = null,
    val loggingOut: Boolean = false,
    val currentVersionName: String = BuildConfig.VERSION_NAME,
    val currentVersionCode: Int = BuildConfig.VERSION_CODE,
    val checkingUpdate: Boolean = false,
    val updateAvailable: AppReleaseDto? = null,
    val updateMessage: String? = null,
    val downloading: Boolean = false,
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val authApi: AuthApi,
    private val authRepository: AuthRepository,
    private val tokenStore: TokenStore,
    private val appUpdater: AppUpdater,
) : ViewModel() {
    private val _state = MutableStateFlow(
        ProfileUiState(
            name = tokenStore.userName,
            email = tokenStore.userEmail,
            mobile = tokenStore.userMobile,
            role = tokenStore.userRole,
        )
    )
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    init {
        refreshFromServer()
        observeDownloadState()
        // Reflect any update already detected elsewhere (e.g. LeadList init).
        _state.update { it.copy(updateAvailable = appUpdater.state.value?.release) }
        // And do a fresh check on entry to Profile.
        checkForUpdate(silent = true)
    }

    private fun refreshFromServer() {
        viewModelScope.launch {
            runCatching { authApi.me() }.onSuccess { me ->
                tokenStore.userName = me.name
                tokenStore.userEmail = me.email
                tokenStore.userMobile = me.mobile
                tokenStore.userRole = me.role
                tokenStore.showFullPhone = me.showFullPhone
                tokenStore.showBucket = me.showBucket
                _state.update {
                    it.copy(name = me.name, email = me.email, mobile = me.mobile, role = me.role)
                }
            }
        }
    }

    fun checkForUpdate(silent: Boolean = false) {
        if (_state.value.checkingUpdate) return
        _state.update { it.copy(checkingUpdate = true, updateMessage = null) }
        viewModelScope.launch {
            val result = runCatching { appUpdater.checkForUpdate() }
            val latest = appUpdater.state.value?.release
            _state.update {
                it.copy(
                    checkingUpdate = false,
                    updateAvailable = latest,
                    updateMessage = when {
                        result.isFailure ->
                            if (silent) null
                            else "Couldn't check for updates — check your connection and try again."
                        latest != null -> null
                        silent -> null
                        else -> "You're on the latest version."
                    },
                )
            }
        }
    }

    /**
     * Mirror AppUpdater's download state into this screen's state.
     *
     * This used to report "Download started" the instant the request was handed
     * to DownloadManager and immediately clear its own `downloading` flag — so
     * the Profile screen claimed success even when the transfer went on to fail.
     * AppUpdater now owns the real lifecycle; this just follows it.
     */
    private fun observeDownloadState() {
        viewModelScope.launch {
            appUpdater.downloading.collect { busy ->
                _state.update {
                    it.copy(
                        downloading = busy,
                        updateMessage = if (busy) "Downloading update…" else it.updateMessage,
                    )
                }
            }
        }
        viewModelScope.launch {
            appUpdater.installError.collect { err ->
                if (err != null) _state.update { it.copy(updateMessage = err) }
            }
        }
    }

    fun downloadAndInstall() {
        val release = _state.value.updateAvailable ?: return
        if (_state.value.downloading) return
        appUpdater.clearInstallError()
        runCatching { appUpdater.startDownload(release) }
            .onFailure { e -> _state.update { it.copy(updateMessage = "Download failed: ${e.message}") } }
    }

    fun logout(onDone: () -> Unit) {
        if (_state.value.loggingOut) return
        _state.update { it.copy(loggingOut = true) }
        viewModelScope.launch {
            authRepository.logout()
            onDone()
        }
    }
}
