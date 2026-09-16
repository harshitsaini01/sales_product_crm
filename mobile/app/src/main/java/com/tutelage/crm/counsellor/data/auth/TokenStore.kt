package com.tutelage.crm.counsellor.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import com.tutelage.crm.counsellor.util.PhoneVisibility

@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs: SharedPreferences

    init {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            "tutelage_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    init { PhoneVisibility.canViewFullNumbers = prefs.getBoolean(KEY_SHOW_FULL_PHONE, false) }

    // Reactive view of "are we logged in" — updated by token setter + clearSession.
    // Lets SessionViewModel flip back to Login when the AuthInterceptor wipes the
    // session after a session-invalidated 401.
    private val _loggedIn = MutableStateFlow(prefs.getString(KEY_TOKEN, null)?.isNotBlank() == true)
    val loggedInFlow: StateFlow<Boolean> = _loggedIn.asStateFlow()

    // Why the last session ended, shown as a banner on the next login screen
    // render. Null when the counsellor signed out themselves (or has never been
    // signed out), in which case Login needs no explanation. Carries the message
    // rather than a boolean because there is more than one involuntary sign-out:
    // kicked out by another device, and an ordinary token expiry.
    private val _signOutNotice = MutableStateFlow<String?>(null)
    val signOutNoticeFlow: StateFlow<String?> = _signOutNotice.asStateFlow()
    fun consumeSignOutNotice() { _signOutNotice.value = null }
    fun noteSignedOut(message: String) { _signOutNotice.value = message }

    /**
     * In-memory mirror of the token.
     *
     * `prefs` is an EncryptedSharedPreferences, so every read is a Tink/keystore
     * decrypt. AuthInterceptor reads the token on EVERY request (and it runs on
     * OkHttp's dispatcher, sometimes off a main-thread-initiated call), which
     * made a keystore round-trip part of the cost of each API call. This class
     * is the only writer, so a cached copy cannot drift.
     */
    @Volatile
    private var cachedToken: String? = prefs.getString(KEY_TOKEN, null)

    var token: String?
        get() = cachedToken
        set(value) {
            cachedToken = value
            prefs.edit().apply {
                if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value)
            }.apply()
            _loggedIn.value = !value.isNullOrBlank()
        }

    var userId: Long
        get() = prefs.getLong(KEY_USER_ID, 0L)
        set(value) = prefs.edit().putLong(KEY_USER_ID, value).apply()

    // Which user's data currently lives in the local (Room/SQLCipher) DB on this
    // device. Deliberately NOT removed by clearSession() — a forced kick-out
    // (single-session enforcement) only invalidates the token, it doesn't wipe
    // the DB, so this must survive that to let the next login() detect a user
    // switch and clear stale calls/leads before they get swept up by a sync and
    // attributed to the wrong counsellor.
    var dbOwnerUserId: Long
        get() = prefs.getLong(KEY_DB_OWNER_USER_ID, 0L)
        set(value) = prefs.edit().putLong(KEY_DB_OWNER_USER_ID, value).apply()

    var userName: String?
        get() = prefs.getString(KEY_USER_NAME, null)
        set(value) = prefs.edit().putString(KEY_USER_NAME, value).apply()

    var userEmail: String?
        get() = prefs.getString(KEY_USER_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_USER_EMAIL, value).apply()

    var userMobile: String?
        get() = prefs.getString(KEY_USER_MOBILE, null)
        set(value) = prefs.edit().putString(KEY_USER_MOBILE, value).apply()

    var userRole: String?
        get() = prefs.getString(KEY_USER_ROLE, null)
        set(value) = prefs.edit().putString(KEY_USER_ROLE, value).apply()

    /** The FCM token the SERVER has acknowledged. Written only after a
     *  successful registration, so a failed one is retried by the next call
     *  site rather than being swallowed and leaving the device without push. */
    var registeredFcmToken: String?
        get() = prefs.getString(KEY_REGISTERED_FCM, null)
        set(value) = prefs.edit().putString(KEY_REGISTERED_FCM, value).apply()

    var showFullPhone: Boolean
        get() = prefs.getBoolean(KEY_SHOW_FULL_PHONE, false)
        set(value) {
            prefs.edit().putBoolean(KEY_SHOW_FULL_PHONE, value).apply()
            PhoneVisibility.canViewFullNumbers = value
        }

    private val _showBucket = MutableStateFlow(prefs.getBoolean(KEY_SHOW_BUCKET, true))
    val showBucketFlow: StateFlow<Boolean> = _showBucket.asStateFlow()

    var showBucket: Boolean
        get() = prefs.getBoolean(KEY_SHOW_BUCKET, true)
        set(value) {
            prefs.edit().putBoolean(KEY_SHOW_BUCKET, value).apply()
            _showBucket.value = value
        }

    /**
     * In-memory mirrors of the two location flags, same reasoning as [cachedToken].
     *
     * `LocationGate.mustEnforce()` reads BOTH on every evaluation, and
     * MandatoryLocationHost re-evaluates the whole gate on a timer from the
     * composition — so each read was a Tink/keystore decrypt on the main
     * thread. This class is the only writer, so the cache cannot drift.
     */
    @Volatile
    private var cachedLocationTrackingEnabled: Boolean =
        prefs.getBoolean(KEY_LOCATION_TRACKING_ENABLED, false)

    @Volatile
    private var cachedLocationRequired: Boolean = prefs.getBoolean(KEY_LOCATION_REQUIRED, false)

    var locationTrackingEnabled: Boolean
        get() = cachedLocationTrackingEnabled
        set(value) {
            cachedLocationTrackingEnabled = value
            prefs.edit().putBoolean(KEY_LOCATION_TRACKING_ENABLED, value).apply()
        }

    var locationRequired: Boolean
        get() = cachedLocationRequired
        set(value) {
            cachedLocationRequired = value
            prefs.edit().putBoolean(KEY_LOCATION_REQUIRED, value).apply()
        }

    var dbPassphrase: String
        get() {
            val existing = prefs.getString(KEY_DB_PASS, null)
            if (existing != null) return existing
            val generated = UUID.randomUUID().toString() + UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DB_PASS, generated).apply()
            return generated
        }
        private set(value) = prefs.edit().putString(KEY_DB_PASS, value).apply()

    val deviceId: String
        get() {
            val existing = prefs.getString(KEY_DEVICE_ID, null)
            if (existing != null) return existing
            val generated = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, generated).apply()
            return generated
        }

    fun clearSession() {
        cachedToken = null
        // Must match the KEY_LOCATION_* removals below, or the gate would keep
        // enforcing against a signed-out session from a stale cache.
        cachedLocationTrackingEnabled = false
        cachedLocationRequired = false
        prefs.edit()
            .remove(KEY_TOKEN)
            // The next session must re-register with FCM: the server ties the
            // token to a user, so a token ACKed for the previous one is not
            // valid for whoever logs in next.
            .remove(KEY_REGISTERED_FCM)
            .remove(KEY_USER_ID)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_MOBILE)
            .remove(KEY_USER_ROLE)
            .remove(KEY_SHOW_FULL_PHONE)
            .remove(KEY_LOCATION_TRACKING_ENABLED)
            .remove(KEY_LOCATION_REQUIRED)
            .apply()
        PhoneVisibility.canViewFullNumbers = false
        _loggedIn.value = false
    }

    companion object {
        private const val KEY_TOKEN = "jwt"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_DB_OWNER_USER_ID = "db_owner_user_id"
        private const val KEY_USER_NAME = "user_name"
        private const val KEY_USER_EMAIL = "user_email"
        private const val KEY_USER_MOBILE = "user_mobile"
        private const val KEY_USER_ROLE = "user_role"
        private const val KEY_REGISTERED_FCM = "registered_fcm_token"
        private const val KEY_SHOW_FULL_PHONE = "show_full_phone"
        private const val KEY_SHOW_BUCKET = "show_bucket"
        private const val KEY_LOCATION_TRACKING_ENABLED = "location_tracking_enabled"
        private const val KEY_LOCATION_REQUIRED = "location_required"
        private const val KEY_DB_PASS = "db_pass"
        private const val KEY_DEVICE_ID = "device_id"
    }
}
