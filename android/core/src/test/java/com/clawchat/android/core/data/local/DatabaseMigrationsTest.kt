package com.clawchat.android.core.data.local

import androidx.sqlite.db.SupportSQLiteDatabase
import io.mockk.mockk
import io.mockk.verify
import org.junit.Assert.assertTrue
import org.junit.Test

class DatabaseMigrationsTest {
    @Test
    fun `migration 1 to 2 adds isolated local tables`() {
        val database = mockk<SupportSQLiteDatabase>(relaxed = true)

        MIGRATION_1_2.migrate(database)

        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("CREATE TABLE IF NOT EXISTS `local_todos`") &&
                    sql.contains("PRIMARY KEY(`id`)")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("CREATE TABLE IF NOT EXISTS `local_events`") &&
                    sql.contains("`startEpochMillis` INTEGER NOT NULL") &&
                    sql.contains("PRIMARY KEY(`id`)")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("index_local_todos_due_date") && sql.contains("`dueDate` ASC")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("index_local_events_start_epoch") &&
                    sql.contains("`startEpochMillis` ASC")
            })
        }
        assertTrue(MIGRATION_1_2.startVersion == 1 && MIGRATION_1_2.endVersion == 2)
    }

    @Test
    fun `migration 2 to 3 rekeys only disposable server caches`() {
        val database = mockk<SupportSQLiteDatabase>(relaxed = true)

        MIGRATION_2_3.migrate(database)

        verify(exactly = 1) { database.execSQL("DROP TABLE IF EXISTS `todos`") }
        verify(exactly = 1) { database.execSQL("DROP TABLE IF EXISTS `events`") }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("CREATE TABLE IF NOT EXISTS `todos`") &&
                    sql.contains("`workspaceKey` TEXT NOT NULL") &&
                    sql.contains("PRIMARY KEY(`workspaceKey`, `id`)")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("CREATE TABLE IF NOT EXISTS `events`") &&
                    sql.contains("`workspaceKey` TEXT NOT NULL") &&
                    sql.contains("PRIMARY KEY(`workspaceKey`, `id`)")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("index_todos_workspace_due_date") &&
                    sql.contains("`workspaceKey`, `dueDate`, `status`")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("index_events_workspace_start_time") &&
                    sql.contains("`workspaceKey`, `startTime`, `id`")
            })
        }
        verify(exactly = 0) {
            database.execSQL(match { sql ->
                sql.contains("DROP TABLE", ignoreCase = true) &&
                    (sql.contains("local_todos") || sql.contains("local_events"))
            })
        }
        assertTrue(MIGRATION_2_3.startVersion == 2 && MIGRATION_2_3.endVersion == 3)
    }

    @Test
    fun `migration 3 to 4 adds the durable todo mutation queue`() {
        val database = mockk<SupportSQLiteDatabase>(relaxed = true)

        MIGRATION_3_4.migrate(database)

        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("CREATE TABLE IF NOT EXISTS `pending_todo_mutations`") &&
                    sql.contains("PRIMARY KEY(`workspaceKey`, `operationId`)")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("index_pending_todo_workspace_item_time") &&
                    sql.contains("`workspaceKey`, `todoId`, `changedAt`")
            })
        }
        assertTrue(MIGRATION_3_4.startVersion == 3 && MIGRATION_3_4.endVersion == 4)
    }

    @Test
    fun `migration 4 to 5 expands the workspace outbox`() {
        val database = mockk<SupportSQLiteDatabase>(relaxed = true)

        MIGRATION_4_5.migrate(database)

        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("ALTER TABLE `pending_todo_mutations`") &&
                    sql.contains("`operationType` TEXT NOT NULL DEFAULT 'update'")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("CREATE TABLE IF NOT EXISTS `pending_review_decisions`") &&
                    sql.contains("PRIMARY KEY(`workspaceKey`, `reviewId`)")
            })
        }
        verify(exactly = 1) {
            database.execSQL(match { it.contains("index_pending_review_workspace_time") })
        }
        assertTrue(MIGRATION_4_5.startVersion == 4 && MIGRATION_4_5.endVersion == 5)
    }

    @Test
    fun `migration 5 to 6 adds outbox retry diagnostics`() {
        val database = mockk<SupportSQLiteDatabase>(relaxed = true)

        MIGRATION_5_6.migrate(database)

        listOf("pending_todo_mutations", "pending_review_decisions").forEach { table ->
            verify(exactly = 1) {
                database.execSQL(match { sql ->
                    sql.contains("ALTER TABLE `$table`") &&
                        sql.contains("`attemptCount` INTEGER NOT NULL DEFAULT 0")
                })
            }
            listOf("lastAttemptAt", "lastError", "nextRetryAt").forEach { column ->
                verify(exactly = 1) {
                    database.execSQL(match { sql ->
                        sql.contains("ALTER TABLE `$table`") && sql.contains("`$column` TEXT")
                    })
                }
            }
        }
        assertTrue(MIGRATION_5_6.startVersion == 5 && MIGRATION_5_6.endVersion == 6)
    }

    @Test
    fun `migration 6 to 7 preserves project context in the server todo cache`() {
        val database = mockk<SupportSQLiteDatabase>(relaxed = true)

        MIGRATION_6_7.migrate(database)

        mapOf(
            "projectId" to "TEXT",
            "source" to "TEXT",
            "sourceId" to "TEXT",
            "idempotencyKey" to "TEXT",
            "assignee" to "TEXT",
            "estimatedMinutes" to "INTEGER",
            "projectLabel" to "TEXT",
        ).forEach { (column, type) ->
            verify(exactly = 1) {
                database.execSQL(
                    "ALTER TABLE `todos` ADD COLUMN `$column` $type",
                )
            }
        }
        verify(exactly = 1) {
            database.execSQL(match { sql ->
                sql.contains("index_todos_workspace_project_order") &&
                    sql.contains("`workspaceKey` ASC, `projectId` ASC")
            })
        }
        assertTrue(MIGRATION_6_7.startVersion == 6 && MIGRATION_6_7.endVersion == 7)
    }
}
