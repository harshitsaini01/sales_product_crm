package com.tutelage.crm.counsellor.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isUnspecified
import androidx.compose.ui.unit.sp
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text

/**
 * A number that always renders in full.
 *
 * The stat tiles across this app are laid out with `Modifier.weight(1f)` — three
 * to a row on the dashboard, four in the auto-dialer and the filter-batch list —
 * so the space a value gets is a fixed fraction of the screen regardless of how
 * many digits it has. With a plain `Text` a large bold value either wraps (pushing
 * its own label out of the tile) or is clipped by the parent, which is what makes
 * a count look "half".
 *
 * This keeps the value on one line and steps the font down until it fits, so the
 * digits shrink instead of disappearing. Compose BOM 2024.02 predates the built-in
 * `autoSize` parameter, hence the measure-and-retry loop.
 *
 * Content is held back for the first frame(s) while measuring; without that the
 * value visibly "pops" from full size down to the fitted size.
 */
@Composable
fun StatValue(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    minFontSize: TextUnit = 10.sp,
) {
    val baseSize = if (style.fontSize.isUnspecified) 14.sp else style.fontSize
    var fontSize by remember(text, baseSize) { mutableStateOf(baseSize) }
    var settled by remember(text, baseSize) { mutableStateOf(false) }

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Text(
            text = text,
            style = style.copy(fontSize = fontSize),
            color = color,
            textAlign = textAlign,
            maxLines = 1,
            softWrap = false,
            // Invisible until a pass fits, so the shrink isn't seen as a flicker.
            modifier = Modifier.alpha(if (settled) 1f else 0f),
            onTextLayout = { result ->
                if (result.didOverflowWidth && fontSize > minFontSize) {
                    // 0.92 converges in a handful of passes without looking stepped.
                    val next = fontSize * 0.92f
                    fontSize = if (next < minFontSize) minFontSize else next
                } else {
                    settled = true
                }
            },
        )
    }
}
