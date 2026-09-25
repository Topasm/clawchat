package com.clawchat.android.core.data.local

import androidx.room.*
import com.clawchat.android.core.data.model.Note

@Entity(tableName = "local_notes", foreignKeys = [ForeignKey(
    entity = LocalTodoEntity::class, parentColumns = ["id"], childColumns = ["projectId"], onDelete = ForeignKey.SET_NULL,
)], indices = [Index("projectId")])
data class LocalNoteEntity(
    @PrimaryKey val id: String,
    val content: String,
    val projectId: String?,
    val createdAt: String,
    val updatedAt: String,
) {
    fun toNote() = Note(id, content, projectId, createdAt, updatedAt)
}

@Dao
interface LocalNoteDao {
    @Query("SELECT * FROM local_notes ORDER BY updatedAt DESC, id")
    suspend fun list(): List<LocalNoteEntity>
    @Query("SELECT * FROM local_notes WHERE id = :id")
    suspend fun get(id: String): LocalNoteEntity?
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(note: LocalNoteEntity)
    @Query("UPDATE local_notes SET content = :content, updatedAt = :now WHERE id = :id")
    suspend fun edit(id: String, content: String, now: String)
    @Query("UPDATE local_notes SET projectId = :projectId, updatedAt = :now WHERE id = :id")
    suspend fun move(id: String, projectId: String?, now: String)
    @Query("DELETE FROM local_notes WHERE id = :id")
    suspend fun delete(id: String)
}
