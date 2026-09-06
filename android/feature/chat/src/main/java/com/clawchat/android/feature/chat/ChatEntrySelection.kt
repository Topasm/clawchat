package com.clawchat.android.feature.chat

/** Restore a missing selection without restarting a live thread or overriding user navigation. */
internal fun shouldSelectInitialConversation(requested: String?, selected: String?, consumed: Boolean): Boolean =
    requested != null && requested != selected && (!consumed || selected == null)
