package com.tutelage.crm.counsellor.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tutelage.crm.counsellor.data.auth.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import retrofit2.HttpException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val loginid: String = "",
    val password: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun setLoginId(v: String) = _state.update { it.copy(loginid = v, error = null) }
    fun setPassword(v: String) = _state.update { it.copy(password = v, error = null) }

    fun submit() {
        val s = _state.value
        if (s.loading) return
        if (s.loginid.isBlank() || s.password.isBlank()) {
            _state.update { it.copy(error = "Enter your login ID and password.") }
            return
        }
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val result = authRepository.login(s.loginid.trim(), s.password)
            result.fold(
                onSuccess = { _state.update { it.copy(loading = false, success = true) } },
                onFailure = { e ->
                    _state.update {
                        it.copy(loading = false, error = parseError(e))
                    }
                },
            )
        }
    }

    /** Converts network/server failures into messages a counsellor can act on. */
    private fun parseError(error: Throwable): String = when (error) {
        is HttpException -> when (error.code()) {
            400 -> "Please enter a valid login ID and password."
            401 -> "Login ID or password is incorrect. Please try again."
            403 -> "This account is not permitted to use the mobile app."
            429 -> "Too many login attempts. Please wait a few minutes and try again."
            in 500..599 -> "The server is temporarily unavailable. Please try again shortly."
            else -> "We could not sign you in. Please try again."
        }
        is SocketTimeoutException -> "The connection timed out. Check your internet and try again."
        is UnknownHostException, is ConnectException, is IOException -> "No internet connection. Please check your network and try again."
        else -> "We could not sign you in. Please try again."
    }
}
