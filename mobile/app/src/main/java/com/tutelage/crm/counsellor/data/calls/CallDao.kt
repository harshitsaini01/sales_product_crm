package com.tutelage.crm.counsellor.data.calls

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged

@Dao
interface CallDao {
    @Query("SELECT * FROM calls WHERE leadId = :leadId ORDER BY startedAt DESC")
    fun observeByLeadIdRaw(leadId: Long): Flow<List<CallEntity>>

    @Query("SELECT * FROM calls ORDER BY startedAt DESC LIMIT 200")
    fun observeRecentRaw(): Flow<List<CallEntity>>

    // Room re-runs every observer of a table on ANY write to it, so a single
    // recording-path update used to re-emit — and recompose — the whole call
    // list. distinctUntilChanged drops the emissions where nothing this query
    // selects actually changed.
    fun observeByLeadId(leadId: Long): Flow<List<CallEntity>> =
        observeByLeadIdRaw(leadId).distinctUntilChanged()

    fun observeRecent(): Flow<List<CallEntity>> = observeRecentRaw().distinctUntilChanged()

    @Query("SELECT * FROM calls WHERE deviceCallId = :id")
    suspend fun byDeviceCallId(id: String): CallEntity?

    @Query("SELECT MAX(startedAt) FROM calls")
    suspend fun maxStartedAt(): Long?

    @Query("SELECT * FROM calls WHERE startedAt BETWEEN :fromMs AND :toMs")
    suspend fun findInRange(fromMs: Long, toMs: Long): List<CallEntity>

    @Query("SELECT * FROM calls WHERE syncedAt IS NULL ORDER BY startedAt ASC LIMIT 200")
    suspend fun unsynced(): List<CallEntity>

    @Query("""
        SELECT * FROM calls
        WHERE direction = 'OUTGOING'
          AND endedAt IS NULL
        ORDER BY startedAt DESC
        LIMIT 50
    """)
    suspend fun pendingOutgoing(): List<CallEntity>

    /** RINGING rows that never got finalized — usually because the app was killed
     *  before PhoneStateReceiver.IDLE fired. CallSyncWorker re-reads the OS call
     *  log to close them out so they don't stay as stale RINGING on the server. */
    @Query("""
        SELECT * FROM calls
        WHERE status = 'RINGING'
          AND endedAt IS NULL
          AND startedAt < :olderThanMs
        ORDER BY startedAt ASC
        LIMIT 50
    """)
    suspend fun staleRinging(olderThanMs: Long): List<CallEntity>

    /** Rows that connected (durationSec > 0) but never got a recording attached —
     *  e.g. the OEM dialer wrote the file after the receiver's window closed.
     *  CallSyncWorker re-scans for these on every pass so the recording catches up. */
    @Query("""
        SELECT * FROM calls
        WHERE recordingPath IS NULL
          AND durationSec > 0
          AND startedAt >= :sinceMs
          AND status IN ('ANSWERED')
        ORDER BY startedAt DESC
        LIMIT 50
    """)
    suspend fun syncedWithoutRecording(sinceMs: Long): List<CallEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(call: CallEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(calls: List<CallEntity>)

    /**
     * Stamp a row synced ONLY if it still looks like what we shipped.
     *
     * `finalize()` can land between the `unsynced()` read and this write (the
     * OS call-log reconcile correcting status/duration), and it re-dirties the
     * row by setting syncedAt = NULL. Marking unconditionally then buried that
     * correction: the server kept the stale RINGING/NO_ANSWER row forever.
     * Comparing the shipped snapshot makes the update a no-op in that case, so
     * the next pass ships the corrected state.
     *
     * @return rows updated — 0 means the row changed mid-flight.
     */
    @Query("""
        UPDATE calls
        SET serverId = :serverId, syncedAt = :syncedAt
        WHERE deviceCallId = :deviceCallId
          AND status = :status
          AND startedAt = :startedAt
          AND durationSec = :durationSec
    """)
    suspend fun markSyncedIfUnchanged(
        deviceCallId: String,
        serverId: Long,
        syncedAt: Long,
        status: String,
        startedAt: Long,
        durationSec: Int,
    ): Int

    /** Keep the server id even when the row was re-dirtied mid-sync — the
     *  recording uploader needs it, and it never changes for a deviceCallId. */
    @Query("UPDATE calls SET serverId = :serverId WHERE deviceCallId = :deviceCallId")
    suspend fun setServerId(deviceCallId: String, serverId: Long)

    @Query("UPDATE calls SET uploadAttempts = uploadAttempts + 1 WHERE deviceCallId = :deviceCallId")
    suspend fun bumpUploadAttempts(deviceCallId: String)

    /** Park a recording we will not attempt again (oversized, or repeatedly
     *  rejected) so it stops blocking the queue behind it. */
    @Query("UPDATE calls SET uploadAttempts = :attempts WHERE deviceCallId = :deviceCallId")
    suspend fun setUploadAttempts(deviceCallId: String, attempts: Int)

    /**
     * Un-park every recording that ran out of attempts but still has its file.
     *
     * Parking is per-file and permanent: `pendingUploads()` filters on
     * `uploadAttempts < MAX`, so once a recording burns its six tries it is
     * never offered again. That is right when the file is genuinely bad — and
     * wrong when the rejections came from a SERVER bug, which is what the
     * 409-on-answered-calls defect was. Those recordings are real and still on
     * disk; they just need the counter cleared once after the fix ships.
     *
     * Returns the number of rows revived so the caller can log it.
     */
    @Query("""
        UPDATE calls
        SET uploadAttempts = 0
        WHERE recordingPath IS NOT NULL
          AND recordingUploadedAt IS NULL
          AND uploadAttempts >= :maxAttempts
    """)
    suspend fun reviveStuckUploadsRaw(maxAttempts: Int): Int

    suspend fun reviveStuckUploads(): Int = reviveStuckUploadsRaw(MAX_UPLOAD_ATTEMPTS)

    @Query("""
        UPDATE calls
        SET status = :status, startedAt = :startedAt, endedAt = :endedAt, durationSec = :durationSec, syncedAt = NULL
        WHERE deviceCallId = :deviceCallId
    """)
    suspend fun finalize(deviceCallId: String, status: String, startedAt: Long, endedAt: Long, durationSec: Int)

    @Query("UPDATE calls SET recordingPath = :path WHERE deviceCallId = :deviceCallId")
    suspend fun setRecording(deviceCallId: String, path: String)

    @Query("""
        UPDATE calls
        SET simSlot = :slot, simCarrier = :carrier, simNumber = :number, syncedAt = NULL
        WHERE deviceCallId = :deviceCallId
    """)
    suspend fun setSim(deviceCallId: String, slot: Int?, carrier: String?, number: String?)

    @Query("UPDATE calls SET recordingUploadedAt = :at WHERE deviceCallId = :deviceCallId")
    suspend fun markRecordingUploaded(deviceCallId: String, at: Long)

    @Query("""
        SELECT * FROM calls
        WHERE recordingPath IS NOT NULL
          AND recordingUploadedAt IS NULL
          AND serverId IS NOT NULL
          AND uploadAttempts < :maxAttempts
        ORDER BY startedAt ASC
        LIMIT 50
    """)
    suspend fun pendingUploadsRaw(maxAttempts: Int): List<CallEntity>

    suspend fun pendingUploads(): List<CallEntity> = pendingUploadsRaw(MAX_UPLOAD_ATTEMPTS)

    /** Live count of calls that have a local recording file waiting to be
     *  shipped to the server. Used by the Calls screen to show a small
     *  "uploading N recordings…" pill so the counsellor knows recordings
     *  aren't lost when their phone is offline. */
    @Query("""
        SELECT COUNT(*) FROM calls
        WHERE recordingPath IS NOT NULL
          AND recordingUploadedAt IS NULL
          AND uploadAttempts < :maxAttempts
    """)
    fun pendingUploadsCountRaw(maxAttempts: Int): kotlinx.coroutines.flow.Flow<Int>

    fun pendingUploadsCount(): kotlinx.coroutines.flow.Flow<Int> =
        pendingUploadsCountRaw(MAX_UPLOAD_ATTEMPTS).distinctUntilChanged()

    /** Recordings we have given up on — surfaced so a stuck file is visible
     *  rather than silently absent from the CRM. */
    @Query("""
        SELECT COUNT(*) FROM calls
        WHERE recordingPath IS NOT NULL
          AND recordingUploadedAt IS NULL
          AND uploadAttempts >= :maxAttempts
    """)
    fun stuckUploadsCountRaw(maxAttempts: Int): kotlinx.coroutines.flow.Flow<Int>

    fun stuckUploadsCount(): kotlinx.coroutines.flow.Flow<Int> =
        stuckUploadsCountRaw(MAX_UPLOAD_ATTEMPTS).distinctUntilChanged()

    /** Live count of local rows we haven't shipped to the backend yet — usually
     *  zero, non-zero means CallSyncWorker is mid-retry or the device is
     *  offline. Surfacing this prevents the "did my call get logged?" anxiety. */
    @Query("SELECT COUNT(*) FROM calls WHERE syncedAt IS NULL")
    fun unsyncedCountRaw(): kotlinx.coroutines.flow.Flow<Int>

    fun unsyncedCount(): kotlinx.coroutines.flow.Flow<Int> = unsyncedCountRaw().distinctUntilChanged()
}
