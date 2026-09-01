package com.clawchat.android.core.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/** Adds device-owned data without changing the existing server cache tables. */
val MIGRATION_1_2: Migration = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `local_todos` (
                `id` TEXT NOT NULL,
                `title` TEXT NOT NULL,
                `description` TEXT,
                `status` TEXT NOT NULL,
                `priority` TEXT NOT NULL,
                `dueDate` TEXT,
                `completedAt` TEXT,
                `tags` TEXT,
                `parentId` TEXT,
                `sortOrder` INTEGER NOT NULL,
                `source` TEXT,
                `inboxState` TEXT NOT NULL,
                `createdAt` TEXT NOT NULL,
                `updatedAt` TEXT NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `local_events` (
                `id` TEXT NOT NULL,
                `title` TEXT NOT NULL,
                `description` TEXT,
                `startTime` TEXT NOT NULL,
                `startEpochMillis` INTEGER NOT NULL,
                `endTime` TEXT,
                `location` TEXT,
                `isAllDay` INTEGER NOT NULL,
                `reminderMinutes` INTEGER,
                `createdAt` TEXT NOT NULL,
                `updatedAt` TEXT NOT NULL,
                PRIMARY KEY(`id`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_todos_default_order` " +
                "ON `local_todos` (`sortOrder` ASC, `createdAt` DESC, `id` ASC)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_todos_status_order` " +
                "ON `local_todos` (`status` ASC, `sortOrder` ASC, `createdAt` DESC, `id` ASC)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_todos_due_date` " +
                "ON `local_todos` (`dueDate` ASC, `status` ASC)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_events_start_epoch` " +
                "ON `local_events` (`startEpochMillis` ASC, `id` ASC)",
        )
    }
}

/**
 * Re-keys disposable server caches by workspace. Device-owned local tables are
 * intentionally left untouched so an upgrade cannot erase offline-only data.
 */
val MIGRATION_2_3: Migration = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DROP TABLE IF EXISTS `todos`")
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `todos` (
                `workspaceKey` TEXT NOT NULL,
                `id` TEXT NOT NULL,
                `title` TEXT NOT NULL,
                `description` TEXT,
                `status` TEXT NOT NULL,
                `priority` TEXT NOT NULL,
                `dueDate` TEXT,
                `completedAt` TEXT,
                `tags` TEXT,
                `parentId` TEXT,
                `sortOrder` INTEGER NOT NULL,
                `inboxState` TEXT NOT NULL,
                `isRecurring` INTEGER NOT NULL,
                `recurrenceRule` TEXT,
                `createdAt` TEXT NOT NULL,
                `updatedAt` TEXT NOT NULL,
                PRIMARY KEY(`workspaceKey`, `id`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_todos_workspace_order` " +
                "ON `todos` (`workspaceKey` ASC, `sortOrder` ASC, `createdAt` DESC, `id` ASC)",
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_todos_workspace_due_date` " +
                "ON `todos` (`workspaceKey`, `dueDate`, `status`)",
        )

        db.execSQL("DROP TABLE IF EXISTS `events`")
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `events` (
                `workspaceKey` TEXT NOT NULL,
                `id` TEXT NOT NULL,
                `title` TEXT NOT NULL,
                `description` TEXT,
                `startTime` TEXT NOT NULL,
                `endTime` TEXT,
                `location` TEXT,
                `isAllDay` INTEGER NOT NULL,
                `reminderMinutes` INTEGER,
                `createdAt` TEXT NOT NULL,
                `updatedAt` TEXT NOT NULL,
                PRIMARY KEY(`workspaceKey`, `id`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_events_workspace_start_time` " +
                "ON `events` (`workspaceKey`, `startTime`, `id`)",
        )
    }
}

/** Adds a workspace-scoped durable queue for edits made while disconnected. */
val MIGRATION_3_4: Migration = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `pending_todo_mutations` (
                `workspaceKey` TEXT NOT NULL,
                `operationId` TEXT NOT NULL,
                `todoId` TEXT NOT NULL,
                `payload` TEXT NOT NULL,
                `changedAt` TEXT NOT NULL,
                PRIMARY KEY(`workspaceKey`, `operationId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_pending_todo_workspace_item_time` " +
                "ON `pending_todo_mutations` (`workspaceKey`, `todoId`, `changedAt`)",
        )
    }
}

/** Expands the edit queue to create/delete operations and adds review decisions. */
val MIGRATION_4_5: Migration = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "ALTER TABLE `pending_todo_mutations` " +
                "ADD COLUMN `operationType` TEXT NOT NULL DEFAULT 'update'",
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS `pending_review_decisions` (
                `workspaceKey` TEXT NOT NULL,
                `reviewId` TEXT NOT NULL,
                `subjectId` TEXT NOT NULL,
                `decision` TEXT NOT NULL,
                `note` TEXT,
                `changedAt` TEXT NOT NULL,
                PRIMARY KEY(`workspaceKey`, `reviewId`)
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_pending_review_workspace_time` " +
                "ON `pending_review_decisions` (`workspaceKey`, `changedAt`)",
        )
    }
}

/** Persists retry diagnostics for each durable Outbox item. */
val MIGRATION_5_6: Migration = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        listOf("pending_todo_mutations", "pending_review_decisions").forEach { table ->
            db.execSQL(
                "ALTER TABLE `$table` ADD COLUMN `attemptCount` INTEGER NOT NULL DEFAULT 0",
            )
            db.execSQL("ALTER TABLE `$table` ADD COLUMN `lastAttemptAt` TEXT")
            db.execSQL("ALTER TABLE `$table` ADD COLUMN `lastError` TEXT")
            db.execSQL("ALTER TABLE `$table` ADD COLUMN `nextRetryAt` TEXT")
        }
    }
}
