package com.tutelage.crm.counsellor.util

import org.json.JSONObject
import retrofit2.HttpException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Turn a thrown API failure into something worth showing a counsellor.
 *
 * `Throwable.message` on a Retrofit [HttpException] is the status line —
 * "HTTP 403 Forbidden" — so every screen that surfaced `e.message` showed that
 * instead of the reason the server actually sent. The backend's explanations
 * ("This lead is no longer assigned to you") were being written and then
 * thrown away one layer short of the screen.
 *
 * Order of preference: the server's own `error` field, then a message keyed off
 * the status code, then [fallback].
 */
fun Throwable.userMessage(fallback: String = "Something went wrong. Please try again."): String =
    when (this) {
        is SocketTimeoutException ->
            "That took longer than usual. Check your connection and try again."
        is UnknownHostException, is ConnectException ->
            "No internet connection. Check your network and try again."
        is HttpException -> serverError() ?: when (code()) {
            401 -> "Your session has expired. Please sign in again."
            403 -> "You do not have access to this."
            404 -> "That is no longer available."
            in 500..599 -> "The server is temporarily unavailable. Please try again."
            else -> fallback
        }
        // Checked last: UnknownHostException and ConnectException are both
        // IOExceptions, and HttpException is not — so this only catches the
        // remaining transport failures.
        is IOException -> "No internet connection. Check your network and try again."
        else -> message?.takeIf { it.isNotBlank() } ?: fallback
    }

/** The `reason` code the backend attaches to auth/permission failures, if any. */
fun Throwable.errorReason(): String? =
    (this as? HttpException)?.errorJson()?.optString("reason")?.takeIf { it.isNotBlank() }

private fun HttpException.serverError(): String? =
    errorJson()?.optString("error")?.takeIf { it.isNotBlank() }

/**
 * `peek()` rather than `string()`: reading the body outright consumes it, and
 * two callers (a message and a reason) both want a look.
 */
private fun HttpException.errorJson(): JSONObject? = try {
    response()?.errorBody()?.source()?.peek()?.readUtf8()
        ?.takeIf { it.startsWith("{") }
        ?.let { JSONObject(it) }
} catch (_: Throwable) {
    null
}
