package com.tutelage.crm.counsellor.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.auth.TokenStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class SessionViewModel @Inject constructor(
    private val tokenStore: TokenStore,
) : ViewModel() {
    val isLoggedIn: StateFlow<Boolean> = tokenStore.loggedInFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, !tokenStore.token.isNullOrBlank())

    val signOutNotice: StateFlow<String?> = tokenStore.signOutNoticeFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    fun consumeSignOutNotice() = tokenStore.consumeSignOutNotice()
}
