package com.clawchat.android.navigation

/**
 * Screen that holds the item behind a search hit.
 *
 * Hit types are singular (`todo`, `event`, `message`) -- the server's search
 * contract, where the request filter is plural. A task opens on itself and a
 * message in its conversation; an event opens the month, and an unknown type
 * leaves the user where they are.
 */
fun searchHitRoute(
    hitType: String?,
    hitId: String? = null,
    conversationId: String? = null,
): String? = when (hitType) {
    "todo" -> NavRoute.Tasks.destination(hitId)
    "event" -> NavRoute.Calendar.route
    "message" -> NavRoute.Chat.destination(conversationId?.takeIf(String::isNotBlank))
    else -> null
}
