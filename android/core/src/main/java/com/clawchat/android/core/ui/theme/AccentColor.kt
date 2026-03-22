package com.clawchat.android.core.ui.theme

enum class AccentColor(
    val key: String,
    val label: String,
    val swatchArgb: Long,
    val lightPrimary: Long,
    val darkPrimary: Long,
) {
    System("system", "System", 0xFF6C5CE7, 0, 0),
    Purple("purple", "Purple", 0xFF6C5CE7, 0xFF6C5CE7, 0xFFA29BFE),
    Blue("blue", "Blue", 0xFF1976D2, 0xFF1976D2, 0xFF42A5F5),
    Teal("teal", "Teal", 0xFF00897B, 0xFF00897B, 0xFF4DB6AC),
    Green("green", "Green", 0xFF388E3C, 0xFF388E3C, 0xFF66BB6A),
    Orange("orange", "Orange", 0xFFF57C00, 0xFFF57C00, 0xFFFFB74D),
    Pink("pink", "Pink", 0xFFD81B60, 0xFFD81B60, 0xFFF48FB1),
    Red("red", "Red", 0xFFE53935, 0xFFE53935, 0xFFEF5350);

    companion object {
        fun fromKey(key: String): AccentColor =
            entries.find { it.key == key } ?: System
    }
}
