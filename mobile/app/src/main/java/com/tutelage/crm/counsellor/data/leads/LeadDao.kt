package com.tutelage.crm.counsellor.data.leads

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged

@Dao
interface LeadDao {
    // Bounded: this is a convenience cache for offline/search, not the source
        // of truth — the Leads screen pages off the server. Loading an unbounded
        // table into memory on every write was the whole cost of the flow.
    @Query("SELECT * FROM leads ORDER BY updatedAt DESC LIMIT 500")
    fun observeAllRaw(): Flow<List<LeadEntity>>

    @Query("""
        SELECT * FROM leads
        WHERE name LIKE '%' || :q || '%'
           OR mobile LIKE '%' || :q || '%'
           OR mobile2 LIKE '%' || :q || '%'
           OR email LIKE '%' || :q || '%'
        ORDER BY updatedAt DESC
        LIMIT 500
    """)
    fun searchRaw(q: String): Flow<List<LeadEntity>>

    // Room re-runs table observers on ANY write to `leads`; a sync that touches
    // one row used to re-emit the whole list and recompose everything watching it.
    fun observeAll(): Flow<List<LeadEntity>> = observeAllRaw().distinctUntilChanged()

    fun search(q: String): Flow<List<LeadEntity>> = searchRaw(q).distinctUntilChanged()

    @Query("SELECT * FROM leads WHERE id = :id")
    suspend fun byId(id: Long): LeadEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<LeadEntity>)

    @Query("DELETE FROM leads")
    suspend fun clear()

    @Query("SELECT id FROM leads")
    suspend fun allIds(): List<Long>

    @Query("DELETE FROM leads WHERE id IN (:ids)")
    suspend fun deleteIds(ids: List<Long>)

    /**
     * Drop any locally-cached lead that is no longer assigned to this
     * counsellor — otherwise a reassigned lead lingered until the user cleared
     * app data.
     *
     * Computed as a set difference in Kotlin and deleted in chunks rather than
     * `DELETE ... WHERE id NOT IN (:ids)`. That form expanded the counsellor's
     * ENTIRE assigned-id list into one bound IN clause: a multi-thousand-element
     * variable list driving a full-table scan on every sync, and a hard "too
     * many SQL variables" failure once the list outgrows SQLite's ceiling.
     */
    @Transaction
    suspend fun keepIds(ids: List<Long>) {
        val keep = ids.toHashSet()
        val stale = allIds().filterNot { it in keep }
        stale.chunked(500).forEach { deleteIds(it) }
    }
}
