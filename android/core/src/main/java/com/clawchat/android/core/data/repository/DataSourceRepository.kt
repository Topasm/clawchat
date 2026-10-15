package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.DataSource
import com.clawchat.android.core.data.model.DataSourceQueryRequest
import com.clawchat.android.core.data.model.DataSourceQueryResult
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import com.clawchat.android.core.network.workspaceNotConfigured
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Folders other machines share through the workspace server.
 *
 * Every request is answered by the machine that holds the folder, relayed by
 * the server; a phone never stores the contents.
 */
@Singleton
class DataSourceRepository @Inject constructor(
    private val api: ClawChatApi,
    private val sessionStore: SessionStore,
) {
    suspend fun listSources(): ApiResult<List<DataSource>> {
        val runtime = sessionStore.runtimeState.first()
        if (runtime.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val scope = runtime.activeServerRequestScope() ?: return workspaceNotConfigured()
        return apiCall { api.listDataSources(scope) }
    }

    suspend fun list(sourceId: String, path: String): ApiResult<DataSourceQueryResult> =
        query(sourceId, DataSourceQueryRequest(op = "list", path = path))

    suspend fun read(sourceId: String, path: String): ApiResult<DataSourceQueryResult> =
        query(sourceId, DataSourceQueryRequest(op = "read", path = path))

    suspend fun search(
        sourceId: String,
        path: String,
        text: String,
    ): ApiResult<DataSourceQueryResult> =
        query(sourceId, DataSourceQueryRequest(op = "search", path = path, query = text))

    private suspend fun query(
        sourceId: String,
        request: DataSourceQueryRequest,
    ): ApiResult<DataSourceQueryResult> {
        val runtime = sessionStore.runtimeState.first()
        if (runtime.mode != WorkspaceMode.SERVER) return workspaceNotConfigured()
        val scope = runtime.activeServerRequestScope() ?: return workspaceNotConfigured()
        return apiCall { api.queryDataSource(sourceId, request, scope) }
    }
}
