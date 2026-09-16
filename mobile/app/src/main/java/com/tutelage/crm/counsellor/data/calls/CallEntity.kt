package com.tutelage.crm.counsellor.data.calls

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

/**
 * Indices mirror how CallDao actually queries: every one of these columns is a
 * WHERE or ORDER BY on a path that runs per call event or per DB write.
 * `findInRange` in particular is on the hot path of every PhoneStateReceiver
 * IDLE (the duplicate check), and the two COUNT flows re-run on every insert —
 * all of which were full-table scans that grew with the counsellor's history.
 */
@Entity(
    tableName = "calls",
    indices = [
        Index("leadId"),
        Index("startedAt"),
        Index("syncedAt"),
        Index("status"),
        Index("recordingUploadedAt"),
        Index(value = ["direction", "endedAt"]),
    ],
)
data class CallEntity(
    @PrimaryKey val deviceCallId: String,
    val serverId: Long? = null,
    val leadId: Long? = null,
    val phoneNumber: String,
    val direction: String,
    val status: String,
    val startedAt: Long,
    val endedAt: Long? = null,
    val durationSec: Int = 0,
    val triggerCallId: Long? = null,
    val notes: String? = null,
    val syncedAt: Long? = null,
    val recordingPath: String? = null,
    val recordingUploadedAt: Long? = null,
    val simSlot: Int? = null,
    val simCarrier: String? = null,
    val simNumber: String? = null,
    /** "IN_APP" (counsellor tapped Call in lead detail), "SYSTEM_DIALER" (placed
     *  from the phone's native dialer), or "INCOMING". Drives `triggeredFrom`
     *  on the server, which the web admin shows so they know where the call
     *  originated. */
    val source: String? = null,
    /** Auto-dialer linkage — set when the call was initiated from CampaignRunnerActivity. */
    val campaignContactId: Long? = null,
    val recordingPlayedId: Long? = null,
    /**
     * Failed recording-upload attempts. A file the server keeps rejecting (or
     * one too big to get through a background window) used to be retried
     * forever at the head of the queue; past [MAX_UPLOAD_ATTEMPTS] it is
     * skipped so everything behind it can still ship.
     */
    val uploadAttempts: Int = 0,
)

/** Give-up ceiling for one recording. Deliberately generous — a counsellor on
 *  patchy rural data should not lose a recording to a handful of blips. */
const val MAX_UPLOAD_ATTEMPTS = 6

/** Recordings above this are not attempted: a background upload window can't
 *  finish them on mobile data, so they would just burn retries and block the
 *  queue. Surfaced in the log with the real size so it can be chased. */
const val MAX_RECORDING_BYTES = 40L * 1024 * 1024

@Serializable
data class CallSyncItemDto(
    val deviceCallId: String,
    /**
     * The lead this call was actually placed against, when the app knows it —
     * i.e. every call started from a lead screen, the auto-dialer, or a CRM
     * click-to-call. Sending it is what stops the server from having to guess
     * by phone number: with two leads sharing a mobile the guess could attach
     * the call to the wrong one, leaving the real lead's task item pending.
     * Null for calls the app didn't originate (system dialer, incoming), where
     * the server's phone match remains the only option.
     */
    val leadId: Long? = null,
    val phoneNumber: String,
    val direction: String,
    val status: String,
    val startedAt: String,
    val endedAt: String? = null,
    val durationSec: Int = 0,
    val triggerCallId: Long? = null,
    val notes: String? = null,
    val simSlot: Int? = null,
    val simCarrier: String? = null,
    val simNumber: String? = null,
    val source: String? = null,
    val campaignContactId: Long? = null,
    val recordingPlayedId: Long? = null,
)

@Serializable
data class CallSyncRequest(val calls: List<CallSyncItemDto>)

@Serializable
data class CallSyncResultItem(val deviceCallId: String, val id: Long)

@Serializable
data class CallSyncResponse(val synced: Int, val results: List<CallSyncResultItem>)
