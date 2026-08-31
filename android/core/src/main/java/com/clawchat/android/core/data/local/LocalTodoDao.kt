package com.clawchat.android.core.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import com.clawchat.android.core.data.model.TodoUpdate
import kotlinx.coroutines.flow.Flow
import java.time.ZoneId

data class LocalTodoPage(
    val items: List<LocalTodoEntity>,
    val total: Int,
)

data class LocalTodoSearchRow(
    val id: String,
    val title: String,
    val description: String?,
    val createdAt: String,
)

@Dao
interface LocalTodoDao {
    @Query("SELECT * FROM local_todos ORDER BY sortOrder ASC, createdAt DESC, id ASC")
    fun getAllFlow(): Flow<List<LocalTodoEntity>>

    @Query(
        """
        SELECT * FROM local_todos
        WHERE (:status IS NULL OR status = :status)
          AND (:priority IS NULL OR priority = :priority)
          AND (:inboxState IS NULL OR inboxState = :inboxState)
          AND (NOT :filterParent OR parentId = :parentId)
          AND (NOT :rootOnly OR parentId IS NULL)
          AND (:dueBeforeExclusive IS NULL OR (dueDate IS NOT NULL AND dueDate < :dueBeforeExclusive))
        ORDER BY
          CASE WHEN :orderBy = 'default' THEN sortOrder END ASC,
          CASE WHEN :orderBy = 'default' THEN createdAt END DESC,
          CASE WHEN :orderBy = 'created_at' AND :ascending THEN createdAt END ASC,
          CASE WHEN :orderBy = 'created_at' AND NOT :ascending THEN createdAt END DESC,
          CASE WHEN :orderBy = 'updated_at' AND :ascending THEN updatedAt END ASC,
          CASE WHEN :orderBy = 'updated_at' AND NOT :ascending THEN updatedAt END DESC,
          CASE WHEN :orderBy = 'sort_order' AND :ascending THEN sortOrder END ASC,
          CASE WHEN :orderBy = 'sort_order' AND NOT :ascending THEN sortOrder END DESC,
          CASE WHEN :orderBy = 'priority' AND :ascending THEN priority END ASC,
          CASE WHEN :orderBy = 'priority' AND NOT :ascending THEN priority END DESC,
          CASE WHEN :orderBy = 'due_date' AND :ascending THEN dueDate END ASC,
          CASE WHEN :orderBy = 'due_date' AND NOT :ascending THEN dueDate END DESC,
          id ASC
        LIMIT :limit OFFSET :offset
        """,
    )
    suspend fun loadPageRows(
        status: String?,
        priority: String?,
        inboxState: String?,
        filterParent: Boolean,
        parentId: String?,
        rootOnly: Boolean,
        dueBeforeExclusive: String?,
        orderBy: String,
        ascending: Boolean,
        limit: Int,
        offset: Int,
    ): List<LocalTodoEntity>

    @Query(
        """
        SELECT COUNT(*) FROM local_todos
        WHERE (:status IS NULL OR status = :status)
          AND (:priority IS NULL OR priority = :priority)
          AND (:inboxState IS NULL OR inboxState = :inboxState)
          AND (NOT :filterParent OR parentId = :parentId)
          AND (NOT :rootOnly OR parentId IS NULL)
          AND (:dueBeforeExclusive IS NULL OR (dueDate IS NOT NULL AND dueDate < :dueBeforeExclusive))
        """,
    )
    suspend fun countPageRows(
        status: String?,
        priority: String?,
        inboxState: String?,
        filterParent: Boolean,
        parentId: String?,
        rootOnly: Boolean,
        dueBeforeExclusive: String?,
    ): Int

    @Transaction
    suspend fun loadPage(
        status: String?,
        priority: String?,
        inboxState: String?,
        filterParent: Boolean,
        parentId: String?,
        rootOnly: Boolean,
        dueBeforeExclusive: String?,
        orderBy: String,
        ascending: Boolean,
        limit: Int,
        offset: Int,
    ): LocalTodoPage = LocalTodoPage(
        items = loadPageRows(
            status = status,
            priority = priority,
            inboxState = inboxState,
            filterParent = filterParent,
            parentId = parentId,
            rootOnly = rootOnly,
            dueBeforeExclusive = dueBeforeExclusive,
            orderBy = orderBy,
            ascending = ascending,
            limit = limit,
            offset = offset,
        ),
        total = countPageRows(
            status = status,
            priority = priority,
            inboxState = inboxState,
            filterParent = filterParent,
            parentId = parentId,
            rootOnly = rootOnly,
            dueBeforeExclusive = dueBeforeExclusive,
        ),
    )

    @Query("SELECT * FROM local_todos WHERE id = :id")
    suspend fun getById(id: String): LocalTodoEntity?

    @Query(
        "SELECT * FROM local_todos WHERE dueDate IS NOT NULL " +
            "AND dueDate < :toExclusive " +
            "AND status != 'completed' AND status != 'cancelled' " +
            "ORDER BY dueDate ASC, id ASC",
    )
    suspend fun getOpenDueBefore(toExclusive: String): List<LocalTodoEntity>

    @Query(
        "SELECT * FROM local_todos WHERE status = 'in_progress' " +
            "AND (dueDate IS NULL OR dueDate < :fromInclusive OR dueDate >= :toExclusive) " +
            "ORDER BY sortOrder ASC, createdAt DESC, id ASC",
    )
    suspend fun getInProgressOutside(
        fromInclusive: String,
        toExclusive: String,
    ): List<LocalTodoEntity>

    @Query("SELECT COUNT(*) FROM local_todos WHERE dueDate IS NULL AND status = 'pending'")
    suspend fun countUndatedPending(): Int

    @Query(
        """
        SELECT id, title, description, createdAt FROM local_todos
        WHERE title LIKE :pattern ESCAPE '\' COLLATE NOCASE
           OR description LIKE :pattern ESCAPE '\' COLLATE NOCASE
        ORDER BY createdAt DESC, id ASC
        LIMIT :limit
        """,
    )
    suspend fun search(pattern: String, limit: Int): List<LocalTodoSearchRow>

    @Upsert
    suspend fun upsert(todo: LocalTodoEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfAbsent(todo: LocalTodoEntity): Long

    /** Makes local quick-capture retries idempotent at the database boundary. */
    @Transaction
    suspend fun insertOrGet(todo: LocalTodoEntity): LocalTodoEntity {
        val rowId = insertIfAbsent(todo)
        return if (rowId == -1L) {
            requireNotNull(getById(todo.id))
        } else {
            todo
        }
    }

    /** Serializes read-modify-write patches so concurrent edits do not clobber fields. */
    @Transaction
    suspend fun updateExisting(
        id: String,
        update: TodoUpdate,
        now: String,
        zoneId: ZoneId,
    ): LocalTodoEntity? {
        val current = getById(id) ?: return null
        return current.applyUpdate(update, now, zoneId).also { upsert(it) }
    }

    @Query("DELETE FROM local_todos WHERE id = :id")
    suspend fun deleteById(id: String)
}
