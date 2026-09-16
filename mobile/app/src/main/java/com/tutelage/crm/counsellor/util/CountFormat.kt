package com.tutelage.crm.counsellor.util

/**
 * One place for turning counts into display strings. Previously every screen
 * did its own `.toString()` (and two screens each had a private duplicate of
 * `toLocaleString()`), so the same number could render three different ways in
 * three different tabs.
 *
 * Nothing here ever truncates a number silently — when a value is shortened it
 * always carries a "+" so the reader knows the real figure is larger.
 */

/** 1234567 -> "12,34,567"-style grouping for the current locale. Never abbreviates. */
fun Int.toLocaleString(): String = "%,d".format(this)

fun Long.toLocaleString(): String = "%,d".format(this)

/**
 * Count for a small pill/badge where only a couple of glyphs fit.
 * 8 -> "8", 150 -> "99+". The "+" is never dropped: a capped value without it
 * reads as an exact count and understates the real number.
 */
fun Int.toBadgeCount(max: Int = 99): String = if (this > max) "$max+" else toString()

/**
 * "showing N of TOTAL" style suffix for a list that was cut short client-side.
 * Returns null when nothing was hidden, so callers can omit the chip entirely.
 */
fun overflowSuffix(shown: Int, total: Int): String? =
    if (total > shown) "+${total - shown}" else null
