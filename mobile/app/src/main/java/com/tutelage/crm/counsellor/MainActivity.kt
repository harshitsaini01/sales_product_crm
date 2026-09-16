package com.tutelage.crm.counsellor

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.tutelage.crm.counsellor.ui.nav.AppNav
import com.tutelage.crm.counsellor.ui.theme.TutelageTheme
import dagger.hilt.android.AndroidEntryPoint
import timber.log.Timber

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val mediaAudioLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* result ignored */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // POST_NOTIFICATIONS is deliberately NOT requested here: MandatoryLocationHost
        // now blocks the app until it (and every other required permission) is granted,
        // and firing a second request from here would race that gate's own prompt —
        // Android queues them and the user sees two dialogs fight for the foreground.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            mediaAudioLauncher.launch(Manifest.permission.READ_MEDIA_AUDIO)
        }
        maybeRequestAllFilesAccess()
        setContent {
            TutelageTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AppNav()
                }
            }
        }
    }

    /**
     * On Android 11+ the OEM call-recording folders (MIUI, Vivo, Samsung) are NOT
     * indexed by MediaStore, so reading them requires "All files access". We send
     * the user to the system settings screen exactly once per install to grant it.
     * The flag is stored in SharedPreferences so we don't nag.
     */
    private fun maybeRequestAllFilesAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        if (Environment.isExternalStorageManager()) return
        val prefs = getSharedPreferences("permissions", MODE_PRIVATE)
        if (prefs.getBoolean("all_files_prompted", false)) return
        prefs.edit().putBoolean("all_files_prompted", true).apply()
        runCatching {
            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        }.onFailure {
            Timber.w(it, "Failed to open All-Files-Access settings; user must grant manually")
        }
    }
}
