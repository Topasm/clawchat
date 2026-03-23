package com.clawchat.android.core.ui.theme

enum class ThemeMode(
    val key: String,
    val label: String,
) {
    Light("light", "Light"),
    Dark("dark", "Dark"),
    System("system", "System");

    companion object {
        fun fromKey(key: String): ThemeMode =
            entries.find { it.key == key } ?: Light
    }
}
