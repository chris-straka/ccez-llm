package studio.ccez.app.ui

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import studio.ccez.app.R

/**
 * Fira Code, desktop parity: ccez-llm bundles Fira Code for code text
 * (UI copy stays system sans on both). Latin subset keeps the APK lean;
 * non-Latin code falls back to the system monospace.
 */
val FiraCode = FontFamily(
    Font(R.font.firacode_regular, FontWeight.Normal),
    Font(R.font.firacode_bold, FontWeight.Bold),
)
