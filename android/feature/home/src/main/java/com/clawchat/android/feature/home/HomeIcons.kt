package com.clawchat.android.feature.home

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The home list's line icons, drawn as in the design: 2-unit strokes on a
 * 24-unit grid with round ends. Only Today's star is filled. Each is tinted
 * where it is used.
 */
internal object HomeIcons {
    val Search: ImageVector by lazy {
        outline("Search", "M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0z", "M21 21l-4.3-4.3")
    }

    val Inbox: ImageVector by lazy {
        outline(
            "Inbox",
            "M22 12h-6l-2 3h-4l-2-3H2",
            "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
        )
    }

    val Star: ImageVector by lazy {
        ImageVector.Builder("Star", 24.dp, 24.dp, 24f, 24f).apply {
            addPath(
                pathData = addPathNodes("M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"),
                fill = SolidColor(Color.Black),
            )
        }.build()
    }

    val Calendar: ImageVector by lazy {
        outline(
            "Calendar",
            "M6 4h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
            "M16 2v4M8 2v4M3 10h18",
        )
    }

    val List: ImageVector by lazy {
        outline("List", "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01")
    }

    val Clock: ImageVector by lazy {
        outline("Clock", "M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0z", "M12 7v5l3 2")
    }

    val Chat: ImageVector by lazy {
        outline("Chat", "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z")
    }

    val Settings: ImageVector by lazy {
        outline(
            "Settings",
            "M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
            "M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
        )
    }

    private fun outline(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            paths.forEach { path ->
                addPath(
                    pathData = addPathNodes(path),
                    fill = null,
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()
}
