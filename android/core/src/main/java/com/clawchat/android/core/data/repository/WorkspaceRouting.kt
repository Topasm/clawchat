package com.clawchat.android.core.data.repository

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.network.networkScope

/** Pins a repository request to the server in the same atomic runtime snapshot. */
internal fun AppRuntimeState.activeServerRequestScope(): ExpectedSessionScope? =
    activeSession?.networkScope()?.let(::ExpectedSessionScope)

/** Rejects deferred UI/background mutations after their workspace is replaced. */
internal fun AppRuntimeState.workspaceMismatch(
    expectedWorkspaceKey: String?,
): ApiResult.Error? = expectedWorkspaceKey
    ?.takeIf { it != workspaceKey }
    ?.let {
        ApiResult.Error(
            message = "The active workspace changed before the operation could be saved",
            code = 409,
            serverCode = "workspace_changed",
        )
    }
