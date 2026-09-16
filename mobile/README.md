# Tutelage Counsellor — Android App

Sideloaded Android app for counsellors. Phase 1 covers login + lead sync.

## Open in Android Studio

1. Install **Android Studio Hedgehog (2023.1.1)** or newer.
2. `File → Open` and select this `mobile/` folder.
3. Android Studio will prompt to install Gradle 8.2+, Android SDK 34, NDK if missing — accept.
4. Studio will generate the Gradle wrapper (`gradlew`, `gradle/wrapper/`) on first sync. Commit those.

## Required before first run

1. **`google-services.json`** — drop the file from your Firebase project into `mobile/app/google-services.json`. Without it the build fails (the `google-services` Gradle plugin requires it).
2. **`local.properties`** — Studio creates this automatically. Add the backend URL if needed:
   ```
   sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
   API_BASE_URL=http://192.168.1.50:3001/
   ```
   Defaults to `http://10.0.2.2:3001/` (emulator → host loopback). For a physical device on the same LAN, use the dev box's LAN IP.

## Run

- Plug in an Android device with USB debugging on, or boot an emulator (API 34 recommended).
- `Run → Run 'app'` or `./gradlew :app:installDebug`.
- Login with any **counsellor** account (admin accounts are rejected with 403).

## Architecture (Phase 1)

```
ui/auth        Login screen + ViewModel + session check
ui/leads       Lead list (search, sync), lead detail, "Call" placeholder (ACTION_DIAL)
ui/nav         NavHost — login → leads → lead detail
data/auth      Retrofit AuthApi, AuthRepository, EncryptedSharedPrefs TokenStore
data/leads     Retrofit LeadApi, Room DAO/Entity, LeadRepository (delta sync via ?since=)
data/db        Room AppDatabase backed by SQLCipher
network        OkHttp AuthInterceptor — injects Bearer token, clears on 401
fcm            FirebaseMessagingService — registers token on rotate, stub for click-to-call
di             Hilt modules (NetworkModule, StorageModule)
```

## Endpoints used (must be live on backend)

- `POST /api/mobile/login`
- `POST /api/mobile/fcm-token`
- `POST /api/mobile/logout`
- `GET  /api/mobile/me`
- `GET  /api/mobile/leads/sync?since=ISO`

## What's NOT in Phase 1

- Real outgoing call placement (we use `ACTION_DIAL` as a placeholder — Phase 2 wires `ACTION_CALL` + foreground service + call log sync).
- Recording (Phase 4 — AccessibilityService).
- Click-to-call FCM payload handling (Phase 3 — service skeleton already in place).
- Multi-module split — single `:app` module for v1; refactor only if compile times become a problem.

## Build a debug APK for sideload

```
./gradlew :app:assembleDebug
# → mobile/app/build/outputs/apk/debug/app-debug.apk
```

Switch `signingConfig` in `app/build.gradle.kts` to a release keystore before distributing widely.
