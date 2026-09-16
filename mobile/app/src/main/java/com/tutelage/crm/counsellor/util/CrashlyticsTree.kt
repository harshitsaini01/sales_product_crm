package com.tutelage.crm.counsellor.util

import android.util.Log
import com.google.firebase.crashlytics.FirebaseCrashlytics
import timber.log.Timber

/**
 * Release logging tree: forwards WARN and above to Crashlytics.
 *
 * Timber was never planted at all before this, so all ~87 log calls across the
 * app were silent no-ops in both debug and release. That meant a counsellor
 * reporting "my calls didn't sync" left literally nothing to look at — every
 * swallowed sync failure, every rejected APK checksum, every `goAsync() failed`
 * went nowhere.
 *
 * WARN/ERROR become Crashlytics breadcrumbs so they arrive as context attached
 * to the next crash or non-fatal; an ERROR carrying a throwable is additionally
 * recorded as a non-fatal in its own right. DEBUG/VERBOSE/INFO are dropped —
 * they are high-volume (the call-sync path logs per row) and Crashlytics keeps
 * only the last 64 entries, so letting them through would evict the breadcrumbs
 * that actually matter.
 */
class CrashlyticsTree : Timber.Tree() {

    private val crashlytics by lazy { FirebaseCrashlytics.getInstance() }

    override fun isLoggable(tag: String?, priority: Int): Boolean = priority >= Log.WARN

    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        val safe = scrub(message)
        crashlytics.log(if (tag != null) "[$tag] $safe" else safe)
        if (priority >= Log.ERROR && t != null) crashlytics.recordException(t)
    }

    private companion object {
        /**
         * Any run of 5+ digits, which is what a phone number, a phone tail or a
         * deviceCallId looks like in our log lines.
         *
         * This app handles student PII, and several call sites put number
         * fragments straight into the message: PhoneStateReceiver logs the
         * 10-digit `tail`, and CallRepository logs `deviceCallId`, which is
         * built as `<direction>_<userId>_<startedAt>_<duration>_<tail>`. Without
         * this, turning on crash reporting would quietly begin shipping lead
         * phone numbers to a third party — the opposite of what the app's own
         * PhoneMask exists to enforce.
         *
         * Deliberately blunt: it also redacts timestamps and row ids. Losing an
         * epoch millis from a breadcrumb costs far less than leaking a number.
         */
        val DIGIT_RUN = Regex("""\d{5,}""")

        fun scrub(message: String): String = DIGIT_RUN.replace(message, "«redacted»")
    }
}
