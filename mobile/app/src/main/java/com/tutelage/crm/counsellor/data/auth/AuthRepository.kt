package com.tutelage.crm.counsellor.data.auth

import android.content.Context

import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.google.firebase.messaging.FirebaseMessaging
import com.tutelage.crm.counsellor.BuildConfig
import com.tutelage.crm.counsellor.data.db.AppDatabase
import com.tutelage.crm.counsellor.location.LocationTrackingService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import javax.inject.Inject
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val tokenStore: TokenStore,
    private val database: AppDatabase,
    @ApplicationContext private val context: Context,
) {
    val isLoggedIn: Boolean get() = !tokenStore.token.isNullOrBlank()

    suspend fun login(loginid: String, password: String): Result<LoginUser> = runCatching {
        val fcmToken = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
        val resp = api.login(
            LoginRequest(
                loginid = loginid,
                password = password,
                deviceId = tokenStore.deviceId,
                fcmToken = fcmToken,
                appVersion = BuildConfig.VERSION_NAME,
            )
        )
        // A forced kick-out (single-session enforcement) only clears the token,
        // not the local DB — so if this device's cached calls/leads belong to a
        // *different* counsellor than the one logging in now, wipe them first.
        // Otherwise that stale data gets synced under the new user's identity.
        if (tokenStore.dbOwnerUserId != 0L && tokenStore.dbOwnerUserId != resp.user.id) {
            withContext(Dispatchers.IO) { database.clearAllTables() }
        }
        tokenStore.dbOwnerUserId = resp.user.id
        tokenStore.token = resp.token
        tokenStore.userId = resp.user.id
        // Internal numeric id only — never name/email/number. Lets a field crash
        // be traced to a counsellor to talk to without putting PII in the report.
        runCatching { FirebaseCrashlytics.getInstance().setUserId(resp.user.id.toString()) }
        tokenStore.userName = resp.user.name
        tokenStore.userEmail = resp.user.email
        tokenStore.userMobile = resp.user.mobile
        tokenStore.userRole = resp.user.role
        tokenStore.showFullPhone = resp.user.showFullPhone
        tokenStore.showBucket = resp.user.showBucket
        tokenStore.locationTrackingEnabled = resp.user.locationTrackingEnabled
        tokenStore.locationRequired = resp.user.locationRequired
        if (resp.user.locationTrackingEnabled && LocationTrackingService.hasLocationPermission(context)) LocationTrackingService.start(context)
        resp.user
    }

    /**
     * Register the device's FCM token with the server.
     *
     * Three call sites hit this (login, the leads screen's init, and
     * onNewToken) and every one re-posted the same token on every app open. The
     * last token the server actually ACKed is remembered, so a repeat is a
     * no-op — and, more importantly, a registration that FAILED is not
     * remembered, so the next call site retries it instead of the failure being
     * swallowed and the device silently losing click-to-call pushes.
     */
    suspend fun registerFcmToken(fcmToken: String) = runCatching {
        if (fcmToken.isBlank()) return@runCatching
        if (tokenStore.token.isNullOrBlank()) return@runCatching
        if (fcmToken == tokenStore.registeredFcmToken) return@runCatching
        api.registerFcmToken(FcmTokenRequest(fcmToken, tokenStore.deviceId, BuildConfig.VERSION_NAME))
        tokenStore.registeredFcmToken = fcmToken
    }
    /**
     * Best-effort server notification, then a local teardown that MUST happen.
     *
     * Every step used to sit inside one runCatching, so anything throwing before
     * clearSession() — a Firebase hiccup, LocationTrackingService.stop() on an
     * OEM that objects — left the counsellor still signed in with their session
     * intact, while the UI had already navigated them to Login. The remote call
     * is allowed to fail; wiping the token and the local DB is not optional.
     */
    suspend fun logout() {
        runCatching {
            val fcmToken = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
            api.logout(LogoutRequest(fcmToken))
        }
        runCatching { FirebaseCrashlytics.getInstance().setUserId("") }
        runCatching { LocationTrackingService.stop(context) }
        tokenStore.clearSession()
        withContext(Dispatchers.IO) { runCatching { database.clearAllTables() } }
    }
}
