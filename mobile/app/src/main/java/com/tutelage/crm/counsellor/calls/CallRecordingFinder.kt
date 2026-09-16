package com.tutelage.crm.counsellor.calls

import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.delay
import timber.log.Timber
import java.io.File

/**
 * After a call ends, the OEM dialer writes a recording file somewhere on shared
 * storage. This object hunts that file down and returns its absolute path so the
 * upload worker can ship it to the CRM.
 *
 * Strategy:
 *   1. Direct File scan of well-known OEM folders (works when MANAGE_EXTERNAL_STORAGE
 *      is granted, or pre-Android-11).
 *   2. MediaStore.Audio query as fallback (works on Android 13+ with READ_MEDIA_AUDIO
 *      for files that the OS has indexed — Pixel/OnePlus/Samsung newer builds).
 *
 * The file may not exist immediately on call-end (OEMs take 1–5s to flush), so
 * [find] retries with backoff for up to ~8 seconds.
 */
object CallRecordingFinder {

    private val OEM_DIRS = listOf(
        // Pixel (Android 12+), OnePlus 11+, OneUI 6+
        "Recordings/Call",
        "Recordings",
        // Older Samsung
        "Call",
        "Call recordings",
        "CallRecordings",
        "Sounds/CallRecordings",
        // Xiaomi / MIUI
        "MIUI/sound_recorder/call_rec",
        "MIUI/sound_recorder/call",
        // Vivo
        "PhoneRecord",
        "Record/Call",
        // OPPO / Realme / ColorOS
        "Music/Recordings/Call",
        "Music/Recordings",
        // Generic / OnePlus older
        "CallRecorder",
        "PhoneRecording",
    )

    private val AUDIO_EXT = setOf("m4a", "mp3", "amr", "wav", "ogg", "aac", "3gp", "3gpp")

    /**
     * Look for a recording matching this call. Returns absolute path, or null.
     *
     * @param phoneNumber the lead's number (last 7+ digits used for fuzzy filename match)
     * @param callStartedAtMs epoch ms when the call started
     * @param callEndedAtMs epoch ms when the call ended
     */
    suspend fun find(
        context: Context,
        phoneNumber: String,
        callStartedAtMs: Long,
        callEndedAtMs: Long,
        fastMode: Boolean = false,
    ): String? {
        val tail = phoneNumber.replace(Regex("\\D"), "").takeLast(10)
        // Window: a couple of seconds before start (some recorders timestamp slightly
        // earlier than OFFHOOK) to 30s after end (flush latency).
        val fromMs = callStartedAtMs - 5_000L
        val toMs = callEndedAtMs + 30_000L

        if (fastMode) {
            val match = scanFilesystem(tail, fromMs, toMs)
                ?: queryMediaStore(context, tail, fromMs, toMs)
            if (match != null) {
                Timber.d("CallRecordingFinder matched %s (fast mode)", match)
            } else {
                Timber.w("CallRecordingFinder: no recording found for %s in [%d..%d] (fast mode)", tail, fromMs, toMs)
            }
            return match
        }

        // Retry with backoff — OEMs can take a few seconds to finalise the file.
        val delays = longArrayOf(0L, 1_000L, 2_000L, 3_000L, 2_000L)
        for ((i, d) in delays.withIndex()) {
            if (d > 0) delay(d)
            val match = scanFilesystem(tail, fromMs, toMs)
                ?: queryMediaStore(context, tail, fromMs, toMs)
            if (match != null) {
                Timber.d("CallRecordingFinder matched %s (attempt %d)", match, i + 1)
                return match
            }
        }
        Timber.w("CallRecordingFinder: no recording found for %s in [%d..%d]", tail, fromMs, toMs)
        return null
    }

    private fun scanFilesystem(tail: String, fromMs: Long, toMs: Long): String? {
        val root = runCatching { Environment.getExternalStorageDirectory() }.getOrNull() ?: return null
        val candidates = mutableListOf<File>()
        for (sub in OEM_DIRS) {
            val dir = File(root, sub)
            if (!dir.isDirectory) continue
            val files = runCatching { dir.listFiles() }.getOrNull() ?: continue
            for (f in files) {
                if (!f.isFile) continue
                val ext = f.extension.lowercase()
                if (ext !in AUDIO_EXT) continue
                if (f.length() <= 0L) continue
                if (f.lastModified() !in fromMs..toMs) continue
                candidates.add(f)
            }
        }
        return pickBest(candidates, tail)?.absolutePath
    }

    private fun queryMediaStore(
        context: Context,
        tail: String,
        fromMs: Long,
        toMs: Long,
    ): String? {
        // MediaStore stores DATE_MODIFIED in seconds (epoch), not ms.
        val fromSec = fromMs / 1000L
        val toSec = toMs / 1000L
        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DATE_MODIFIED,
        )
        val selection =
            "${MediaStore.Audio.Media.DATE_MODIFIED} BETWEEN ? AND ? AND " +
                "${MediaStore.Audio.Media.SIZE} > 0"
        val args = arrayOf(fromSec.toString(), toSec.toString())
        val candidates = mutableListOf<File>()
        runCatching {
            context.contentResolver.query(uri, projection, selection, args, null)?.use { c ->
                val dataIx = c.getColumnIndex(MediaStore.Audio.Media.DATA)
                val nameIx = c.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME)
                while (c.moveToNext()) {
                    val dataPath = if (dataIx >= 0) c.getString(dataIx) else null
                    val name = if (nameIx >= 0) c.getString(nameIx) else null
                    val path = dataPath ?: continue
                    val lowerPath = path.lowercase()
                    val lowerName = (name ?: "").lowercase()
                    // Only audio files that look like call recordings (avoid pulling
                    // in WhatsApp voice notes, music, etc).
                    val looksLikeCall = listOf("call", "phone", "rec").any {
                        lowerPath.contains(it) || lowerName.contains(it)
                    }
                    if (!looksLikeCall) continue
                    val f = File(path)
                    if (f.isFile && f.length() > 0) candidates.add(f)
                }
            }
        }.onFailure { Timber.w(it, "MediaStore query failed") }
        return pickBest(candidates, tail)?.absolutePath
    }

    private fun pickBest(files: List<File>, tail: String): File? {
        if (files.isEmpty()) return null
        // Prefer file whose name contains the phone tail (full 10 digits or last 7).
        val tail7 = tail.takeLast(7)
        val matched = files.filter {
            val n = it.name
            (tail.isNotEmpty() && n.contains(tail)) ||
                (tail7.isNotEmpty() && n.contains(tail7))
        }
        val pool = if (matched.isNotEmpty()) matched else files
        // Otherwise pick the most recently modified one in the window.
        return pool.maxByOrNull { it.lastModified() }
    }

    /**
     * True if the path is one we found on shared storage (vs one our own MediaRecorder
     * wrote into app filesDir). Caller uses this to decide whether to delete the
     * file after upload — never delete the user's own OEM recording.
     */
    fun isExternalRecording(context: Context, path: String): Boolean {
        val ours = File(context.filesDir, "recordings").absolutePath
        return !path.startsWith(ours)
    }

    fun hasAllFilesAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
        else true
}
