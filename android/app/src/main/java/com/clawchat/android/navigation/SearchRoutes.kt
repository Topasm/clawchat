package com.clawchat.android.navigation

/**
 * Screen that holds the item behind a search hit.
 *
 * Hit types are singular (`todo`, `event`, `message`) — the server's search
 * contract, where the request filter is plural. There are no per-item detail
 * screens on mobile yet, so a hit opens the screen that lists its kind, and an
 * unknown type leaves the user where they are.
 */
fun searchHitRoute(hitType: String?, hitId: String? = null): String? = when (hitType) {
    "todo" -> NavRoute.Tasks.destination(hitId)
    "event" -> NavRoute.Calendar.route
    "message" -> NavRoute.Chat.route
    else -> null
}
