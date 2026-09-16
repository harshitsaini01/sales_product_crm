import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.google.services)
    alias(libs.plugins.crashlytics)
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val apiBaseUrl: String = (localProps.getProperty("API_BASE_URL")
    ?: System.getenv("API_BASE_URL")
    ?: "http://10.0.2.2:3001/")

/**
 * Release signing.
 *
 * Release used to be signed with the SDK's debug keystore, whose credentials
 * are public and identical on every machine — so anyone could build an APK
 * Android would accept as a same-signer update of ours, which is also the
 * second gate the self-updater relies on. Drop a `keystore.properties` next to
 * `local.properties` (git-ignored) with storeFile/storePassword/keyAlias/
 * keyPassword and release builds use it. Without it the build still works but
 * warns loudly and stays debug-signed — never ship that.
 */
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val releaseStoreFile: String? = keystoreProps.getProperty("storeFile")
    ?: System.getenv("ANDROID_KEYSTORE_FILE")
val hasReleaseKeystore = !releaseStoreFile.isNullOrBlank() && rootProject.file(releaseStoreFile).exists()

android {
    namespace = "com.tutelage.crm.counsellor"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.tutelage.crm.counsellor"
        minSdk = 26
        targetSdk = 34
        versionCode = 37
        versionName = "1.1.32"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }

        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = keystoreProps.getProperty("storePassword")
                    ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = keystoreProps.getProperty("keyAlias")
                    ?: System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = keystoreProps.getProperty("keyPassword")
                    ?: System.getenv("ANDROID_KEY_PASSWORD")
                // AGP leaves V3 off by default, and V3 is the only thing that
                // makes signing-key ROTATION possible: it carries a
                // proof-of-rotation lineage so a future key can prove descent
                // from this one and Android accepts the update in place.
                // Without it, every future key change repeats the
                // uninstall-and-reinstall-everyone exercise this release is
                // already forcing once. Turning it on now, while the installed
                // base is being rebuilt from scratch anyway, is free.
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.10"
    }
    sourceSets {
        // Room's exported schema JSON, so a future migration can be written and
        // tested against a real schema history instead of guessed at.
        getByName("androidTest").assets.srcDir("$projectDir/schemas")
    }
    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE*",
                "/META-INF/NOTICE*",
            )
        }
    }
}

/**
 * Release guardrails, checked when a release artifact is actually built rather
 * than at configure time so debug work is never blocked:
 *
 *  - API_BASE_URL must be https. Plain HTTP would put JWTs, student PII and
 *    call recordings on the wire in clear text, and the network security
 *    config would reject the requests at runtime anyway. Override for a
 *    deliberate one-off with -PallowInsecureRelease=true.
 *  - A debug-signed release is announced loudly instead of shipping quietly.
 */
val allowInsecureRelease: Boolean =
    (project.findProperty("allowInsecureRelease") as String?)?.toBoolean() ?: false
val allowDebugSigned: Boolean =
    (project.findProperty("allowDebugSigned") as String?)?.toBoolean() ?: false

tasks.matching { it.name == "assembleRelease" || it.name == "bundleRelease" }.configureEach {
    doFirst {
        if (!apiBaseUrl.startsWith("https://") && !allowInsecureRelease) {
            throw GradleException(
                "Refusing to build a release against a non-HTTPS API_BASE_URL ($apiBaseUrl).\n" +
                    "Set API_BASE_URL=https://... in local.properties (or the environment).\n" +
                    "To override deliberately: ./gradlew assembleRelease -PallowInsecureRelease=true",
            )
        }
        if (!hasReleaseKeystore && !allowDebugSigned) {
            throw GradleException(
                "Refusing to build a DEBUG-SIGNED release.\n" +
                    "No keystore.properties (and no ANDROID_KEYSTORE_FILE), so this APK would be\n" +
                    "signed with the SDK debug key — whose credentials are public. Anyone could\n" +
                    "then build an APK Android accepts as a same-signer update of ours, which is\n" +
                    "also the second gate the self-updater relies on.\n\n" +
                    "Create one:\n" +
                    "  keytool -genkeypair -v -keystore tutelage-release.jks -keyalg RSA \\\n" +
                    "    -keysize 4096 -validity 10000 -alias tutelage\n" +
                    "then copy keystore.properties.example to keystore.properties and fill it in.\n" +
                    "BACK THE .jks UP — losing it means never being able to update installs again.\n\n" +
                    "For a deliberate local test only: ./gradlew assembleRelease -PallowDebugSigned=true",
            )
        }
    }
}

// Room writes the schema for each version here (exportSchema = true). Committed
// so migrations can be diffed and verified rather than reverse-engineered.
ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.navigation.compose)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)

    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.sqlcipher)
    implementation(libs.sqlite.ktx)

    implementation(libs.workmanager)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.crashlytics)

    implementation(libs.security.crypto)
    implementation(libs.coil.compose)
    implementation(libs.timber)
    implementation(libs.play.services.location)
}
