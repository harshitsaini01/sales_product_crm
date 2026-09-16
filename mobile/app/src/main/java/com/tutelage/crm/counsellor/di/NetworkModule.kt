package com.tutelage.crm.counsellor.di

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.tutelage.crm.counsellor.BuildConfig
import com.tutelage.crm.counsellor.data.activity.ActivityApi
import com.tutelage.crm.counsellor.data.auth.AuthApi
// import com.tutelage.crm.counsellor.data.autodialer.AutoDialerApi // auto-dialer disabled
import com.tutelage.crm.counsellor.data.calls.CallApi
import com.tutelage.crm.counsellor.data.dashboard.DashboardApi
import com.tutelage.crm.counsellor.data.leads.LeadApi
import com.tutelage.crm.counsellor.location.LocationApi
import com.tutelage.crm.counsellor.data.release.AppReleaseApi
import com.tutelage.crm.counsellor.data.staging.FilterLeadsApi
import com.tutelage.crm.counsellor.data.leadwork.LeadWorkApi
import com.tutelage.crm.counsellor.network.AuthInterceptor
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Qualifier
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class UpdateCheckClient

/** Recording uploads: multi-megabyte multipart bodies on mobile data. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class RecordingUploadClient

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    @Provides @Singleton
    fun provideOkHttp(authInterceptor: AuthInterceptor): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
            else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .build()
    }

    @Provides @Singleton
    fun provideRetrofit(client: OkHttpClient, json: Json): Retrofit {
        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
    }

    // Short, dedicated timeout for the update-check call only — a "check for
    // updates" tap should fail fast with a clear message on a bad connection
    // instead of hanging for up to the app's normal 60s read timeout.
    @Provides @Singleton @UpdateCheckClient
    fun provideUpdateCheckOkHttp(authInterceptor: AuthInterceptor): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
            else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .build()
    }

    @Provides @Singleton @UpdateCheckClient
    fun provideUpdateCheckRetrofit(@UpdateCheckClient client: OkHttpClient, json: Json): Retrofit {
        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
    }

    // The shared client's 120s writeTimeout is a per-write-operation deadline,
    // which is the wrong shape for a large upload on a slow link: it fires on a
    // stall rather than on total duration, and there was no whole-call ceiling
    // at all. This client gives an upload room to finish while still bounding
    // it, so a genuinely stuck transfer fails instead of hanging a worker.
    @Provides @Singleton @RecordingUploadClient
    fun provideRecordingUploadOkHttp(authInterceptor: AuthInterceptor): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(300, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.MINUTES)
            .build()

    @Provides @Singleton @RecordingUploadClient
    fun provideRecordingUploadRetrofit(
        @RecordingUploadClient client: OkHttpClient,
        json: Json,
    ): Retrofit {
        val contentType = "application/json".toMediaType()
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
    }

    @Provides @Singleton @RecordingUploadClient
    fun provideRecordingUploadApi(@RecordingUploadClient retrofit: Retrofit): CallApi =
        retrofit.create(CallApi::class.java)

    @Provides @Singleton
    fun provideAuthApi(retrofit: Retrofit): AuthApi = retrofit.create(AuthApi::class.java)

    @Provides @Singleton
    fun provideLeadApi(retrofit: Retrofit): LeadApi = retrofit.create(LeadApi::class.java)

    @Provides @Singleton
    fun provideCallApi(retrofit: Retrofit): CallApi = retrofit.create(CallApi::class.java)

    @Provides @Singleton
    fun provideAppReleaseApi(@UpdateCheckClient retrofit: Retrofit): AppReleaseApi = retrofit.create(AppReleaseApi::class.java)

    @Provides @Singleton
    fun provideDashboardApi(retrofit: Retrofit): DashboardApi = retrofit.create(DashboardApi::class.java)

    @Provides @Singleton
    fun provideFilterLeadsApi(retrofit: Retrofit): FilterLeadsApi =
        retrofit.create(FilterLeadsApi::class.java)

    @Provides @Singleton
    fun provideLeadWorkApi(retrofit: Retrofit): LeadWorkApi = retrofit.create(LeadWorkApi::class.java)

    @Provides @Singleton
    fun provideActivityApi(retrofit: Retrofit): ActivityApi = retrofit.create(ActivityApi::class.java)

    @Provides @Singleton
    fun provideLocationApi(retrofit: Retrofit): LocationApi = retrofit.create(LocationApi::class.java)

    // Auto-dialer disabled — provider commented out.
    // @Provides @Singleton
    // fun provideAutoDialerApi(retrofit: Retrofit): AutoDialerApi = retrofit.create(AutoDialerApi::class.java)
}
