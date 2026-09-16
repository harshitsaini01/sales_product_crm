package com.tutelage.crm.counsellor.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Tutelage brand: indigo primary, slate neutrals, supporting accents.
val BrandPrimary = Color(0xFF4F46E5)        // indigo-600
val BrandPrimaryDark = Color(0xFF6366F1)    // indigo-500 (dark mode)
val BrandPrimaryDeep = Color(0xFF3730A3)    // indigo-800 — gradient anchor
val BrandSecondary = Color(0xFF0EA5E9)      // sky-500
val BrandTertiary = Color(0xFF10B981)       // emerald-500 (success / call)
val BrandWarn = Color(0xFFF59E0B)           // amber-500
val BrandError = Color(0xFFEF4444)          // red-500
val BrandViolet = Color(0xFF8B5CF6)         // violet-500 (gradient mid)
val BrandPink = Color(0xFFEC4899)           // pink-500 (hot leads)

/**
 * Diagonal indigo→violet gradient used by the Home hero card and the auth
 * gradient header. Looks the same in both light and dark mode since it's
 * always on a saturated background.
 */
val BrandGradient: Brush = Brush.linearGradient(
    colors = listOf(BrandPrimaryDeep, BrandPrimary, BrandViolet),
)

private val LightColors = lightColorScheme(
    primary = BrandPrimary,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0E7FF),
    onPrimaryContainer = Color(0xFF1E1B4B),
    secondary = BrandSecondary,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE0F2FE),
    onSecondaryContainer = Color(0xFF082F49),
    tertiary = BrandTertiary,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFD1FAE5),
    onTertiaryContainer = Color(0xFF064E3B),
    error = BrandError,
    onError = Color.White,
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF7F1D1D),
    background = Color(0xFFF8FAFC),
    onBackground = Color(0xFF0F172A),
    surface = Color.White,
    onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = Color(0xFF475569),
    // `outline` gets used all over this app as a muted TEXT/icon color (labels,
    // placeholders, empty states, hints), not just for actual borders. The
    // Material default (slate-300, 0xFFCBD5E1) is fine for a border but reads
    // as almost invisible text on a white/near-white surface. Slate-500 keeps
    // the "de-emphasized" intent while staying readable; borders that want the
    // old, lighter look already dial it back with .copy(alpha = 0.5f) etc., so
    // darkening the base color doesn't make those too heavy.
    outline = Color(0xFF64748B),
    outlineVariant = Color(0xFFCBD5E1),
)

private val DarkColors = darkColorScheme(
    primary = BrandPrimaryDark,
    onPrimary = Color(0xFF1E1B4B),
    primaryContainer = Color(0xFF312E81),
    onPrimaryContainer = Color(0xFFE0E7FF),
    secondary = Color(0xFF38BDF8),
    onSecondary = Color(0xFF082F49),
    secondaryContainer = Color(0xFF075985),
    onSecondaryContainer = Color(0xFFE0F2FE),
    tertiary = Color(0xFF34D399),
    onTertiary = Color(0xFF064E3B),
    tertiaryContainer = Color(0xFF065F46),
    onTertiaryContainer = Color(0xFFD1FAE5),
    error = Color(0xFFF87171),
    onError = Color(0xFF7F1D1D),
    errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = Color(0xFFFEE2E2),
    background = Color(0xFF0B1220),
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF111827),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1F2937),
    onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF334155),
    outlineVariant = Color(0xFF1E293B),
)

@Composable
fun TutelageTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
