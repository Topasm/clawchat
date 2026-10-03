package com.clawchat.android.core.notification

/** Where push notifications stand for this install and the server it is paired with. */
enum class PushStatus {
    /** This build carries no Firebase settings; push is off. */
    NOT_CONFIGURED,

    /** Firebase is set up; the token has not reached the server yet. */
    REGISTERING,

    /** The server has the token but no FIREBASE_CREDENTIALS_PATH, so it cannot send. */
    SERVER_DISABLED,

    /** Registered with a server that can send pushes. */
    ACTIVE,
}
