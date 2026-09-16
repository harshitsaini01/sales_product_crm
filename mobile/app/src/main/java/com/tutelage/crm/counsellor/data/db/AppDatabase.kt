package com.tutelage.crm.counsellor.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.tutelage.crm.counsellor.data.calls.CallDao
import com.tutelage.crm.counsellor.data.calls.CallEntity
import com.tutelage.crm.counsellor.data.leads.LeadDao
import com.tutelage.crm.counsellor.data.leads.LeadEntity
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

@Database(
    entities = [LeadEntity::class, CallEntity::class],
    version = 7,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun leadDao(): LeadDao
    abstract fun callDao(): CallDao

    companion object {
        /**
         * v6 → v7: query indices on both tables plus `calls.uploadAttempts`.
         *
         * This is the first REAL migration in the app. Before it the builder
         * used a blanket `fallbackToDestructiveMigration()`, so every schema
         * bump dropped and recreated both tables on the first launch after an
         * update — and the `calls` table is the only copy of un-synced call
         * rows and un-uploaded recording linkages. Leads are a pure cache and
         * re-sync; calls do not.
         *
         * Index names must match exactly what Room generates from the @Index
         * annotations, or Room's post-migration schema validation fails.
         */
        private val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `calls` ADD COLUMN `uploadAttempts` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_calls_leadId` ON `calls` (`leadId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_calls_startedAt` ON `calls` (`startedAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_calls_syncedAt` ON `calls` (`syncedAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_calls_status` ON `calls` (`status`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_calls_recordingUploadedAt` ON `calls` (`recordingUploadedAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_calls_direction_endedAt` ON `calls` (`direction`, `endedAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_leads_updatedAt` ON `leads` (`updatedAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_leads_name` ON `leads` (`name`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_leads_mobile` ON `leads` (`mobile`)")
            }
        }

        fun build(context: Context, passphrase: String): AppDatabase {
            System.loadLibrary("sqlcipher")
            val factory = SupportOpenHelperFactory(passphrase.toByteArray())
            return Room.databaseBuilder(context, AppDatabase::class.java, "tutelage.db")
                .openHelperFactory(factory)
                .addMigrations(MIGRATION_6_7)
                // Versions 1-5 were pre-release dev schemas that no shipped
                // build sits on; wiping those is fine and is the only way to
                // open such a DB without hand-writing four dead migrations.
                // Anything from 6 onward migrates for real.
                .fallbackToDestructiveMigrationFrom(1, 2, 3, 4, 5)
                .build()
        }
    }
}
