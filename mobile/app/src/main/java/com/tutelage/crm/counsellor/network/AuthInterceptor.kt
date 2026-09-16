package com.tutelage.crm.counsellor.network

import com.tutelage.crm.counsellor.data.auth.TokenStore
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: TokenStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val token = tokenStore.token
        val request = if (!token.isNullOrBlank()) {
            original.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        } else original

        val response = chain.proceed(request)
        // Only treat a 401 as "really logged out" when a route that authenticates
        // with OUR token rejects it. A 401 from anywhere else must not nuke the
        // session — otherwise one bad request cascades into a full logout.
        if (response.code == 401 && !token.isNullOrBlank() && shouldClearSession(request.url.encodedPath)) {
            // Peek at the body (without consuming it — the caller still needs to
            // read it) for the server's machine-readable `reason`. Only reasons
            // that mean "this token will never work again" wipe the session; a
            // transient backend blip must NOT bounce the counsellor out of a
            // mid-flow screen, which is what "auto redirects to home" was.
            val reason = peekReason(response)
            if (reason != null) {
                // Tell the counsellor WHY they are back at Login. Being kicked out
                // by another device and a 30-day token simply running out look
                // identical from the login screen otherwise, and the first one is
                // something they need to act on.
                tokenStore.noteSignedOut(NOTICES.getValue(reason))
                tokenStore.clearSession()
            }
        }
        return response
    }

    private fun shouldClearSession(path: String): Boolean =
        path.startsWith("/api/mobile/") ||
            path.startsWith("/api/calls/") ||
            path.startsWith("/api/auto-dialer/") ||
            // Uses authenticateAny, but the app only ever calls it with the mobile
            // token — so a fatal-reason 401 here is the same dead token. Left out
            // before, this endpoint kept polling long after the session had died.
            path.startsWith("/api/app-releases/")

    /**
     * Pull `reason` out of the JSON error body, e.g. {"error":"...","reason":"token_expired"}.
     *
     * Deliberately a substring scan rather than a JSON parse: the body is tiny,
     * this runs on OkHttp's dispatcher for every 401, and a malformed/HTML body
     * (nginx 401 page) must degrade to "no reason" instead of throwing.
     */
    private fun peekReason(response: Response): String? = try {
        val body = response.peekBody(2048).string()
        NOTICES.keys.firstOrNull { body.contains("\"$it\"") }
    } catch (_: Throwable) {
        null
    }

    private companion object {
        /**
         * Every 401 reason that means the stored token is permanently dead.
         *
         * `token_expired` is the one that mattered: mobile JWTs live 30 days and
         * there is no refresh flow, so every counsellor's token dies monthly. The
         * server used to return a bare "Invalid or expired mobile token" with no
         * reason, this interceptor could not classify it, the session was kept —
         * and every poller (home overview, today's followups, activity ping,
         * location upload, lead-work batches, release check) went on hammering the
         * API with a dead token forever. That loop was the bulk of our 401 volume.
         *
         * `token_missing` is deliberately NOT here: we only reach this branch when
         * we DID attach a token, so that reason means something between us and the
         * app stripped the Authorization header (a proxy, a captive portal). The
         * token itself is fine — logging the counsellor out over an infra hiccup
         * would be the same over-reaction this interceptor exists to avoid.
         *
         * Keep in sync with AUTH_FATAL_REASONS in backend/src/middleware/mobile-auth.ts.
         */
        val NOTICES = mapOf(
            "session_invalidated" to
                "You were signed out because this account is now signed in on another device.",
            "token_expired" to
                "Your session expired. Please sign in again.",
            "token_invalid" to
                "Your session is no longer valid. Please sign in again.",
        )
    }
}
