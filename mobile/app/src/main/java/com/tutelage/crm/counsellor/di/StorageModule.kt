package com.tutelage.crm.counsellor.di

import android.content.Context
import com.tutelage.crm.counsellor.data.auth.TokenStore
import com.tutelage.crm.counsellor.data.calls.CallDao
import com.tutelage.crm.counsellor.data.db.AppDatabase
import com.tutelage.crm.counsellor.data.leads.LeadDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object StorageModule {

    @Provides @Singleton
    fun provideDatabase(@ApplicationContext ctx: Context, tokenStore: TokenStore): AppDatabase =
        AppDatabase.build(ctx, tokenStore.dbPassphrase)

    @Provides
    fun provideLeadDao(db: AppDatabase): LeadDao = db.leadDao()

    @Provides
    fun provideCallDao(db: AppDatabase): CallDao = db.callDao()
}
