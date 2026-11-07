# Android verification record

Verified on 2026-11-07 using a dedicated AOSP Android 35 arm64-v8a emulator on
an Apple Silicon Mac. This is evidence for the reference spike, not a claim
about production behavior or physical devices.

## Build

Official local generators produced the Connect-Kotlin client and Java protobuf
messages from the shared schema. The debug APK built successfully with:

- Connect-Kotlin 0.10.0 and protobuf 4.36.2 (protoc 36.2).
- Gradle 9.8.1, Android Gradle Plugin 9.3.1, Kotlin 2.4.21 (language/API 2.2).
- Java 25.0.2, compile SDK 37 and Android Build Tools 36.0.0.
- One Gradle worker, no parallel build, 1536 MB JVM heap.

The recorded build finished successfully in 1 minute 33 seconds, with 35 tasks.
It emitted source-directory API deprecation warnings, so the tested Gradle
version is pinned; Gradle 10 compatibility has not been established.

## Actual emulator execution

The test queried Android API `35` and ABI `arm64-v8a`, installed the APK, and
launched `com.intrepion.spike/.MainActivity`. The app used the real generated
Connect-Kotlin client against the companion Connect-Rust/Axum service, connected
through adb reverse to the host's loopback-only port 4100.

Captured app result:

```text
PASS: Android greeting, server identity, and invalid_argument
```

The assertions verified a trimmed greeting, server identity `connect-rust/axum`,
and a whitespace-only request returning typed `Code.INVALID_ARGUMENT`.
This used Connect binary Protobuf, not a mock transport or handwritten protocol.

The test removed its adb reverse, stopped its dedicated emulator and isolated
adb server, and stopped its owned Rust server. Ports 4100, 5038 and 5580 were
verified clear. No physical device was authorized or used. The dedicated AVD
and installed SDK components were retained for reuse.

Raw build/runtime logs were kept locally outside the commit candidate set.
The companion README describes how to regenerate, build and repeat the check.

## Commit-preparation recheck

The formatted Android source rebuilt offline with one Gradle worker. The hardened
Python runner then repeated the real API35 arm64 emulator check successfully,
using a foreground isolated ADB server, explicit command deadlines and owned
process-group cleanup. The same three SDK assertions passed and the runner
exited 0. No new dependencies or SDK components were installed for the recheck.

Afterward, no listeners remained on ports 4100, 5038, 5580 or 5581, and no owned
emulator, ADB, service or runner processes remained. The accompanying offline
suite covers prerequisites, occupied ports, stalled commands, signal handling
and cleanup separately from this real-SDK execution.
