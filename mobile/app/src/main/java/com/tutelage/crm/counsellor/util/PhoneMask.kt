package com.tutelage.crm.counsellor.util

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Session-scoped visibility granted by the CRM administrator. */
object PhoneVisibility {
    var canViewFullNumbers: Boolean by mutableStateOf(false)
}

fun maskPhone(value: String?): String {
    if (value.isNullOrBlank()) return "—"
    if (PhoneVisibility.canViewFullNumbers) return value.trim()
    val trimmed = value.trim()
    // Keep the leading "+" of an international number. Filtering to digits dropped
    // it, so +919876543210 masked to "9198765 •••••" — indistinguishable from a
    // local number and impossible to tell apart at a glance in a list.
    val plus = if (trimmed.startsWith("+")) "+" else ""
    val digits = trimmed.filter { it.isDigit() }
    if (digits.length <= 5) return trimmed
    return plus + digits.dropLast(5) + " •••••"
}
