# Android Connect-Kotlin compatibility test: PASS

Executed on an Apple Silicon Mac on 2026-11-07 against the disposable Rust/Axum
service bound to `127.0.0.1:4100`. No real data or authentication was used.

## Verified

- Official Connect-Kotlin 0.10.0 generated client and Google Java protobuf messages.
- APK compiled and packaged with Gradle 9.8.1, AGP 9.3.1, Kotlin 2.4.21
  (language/API 2.2), Java 25.0.2, existing Android API 37 SDK and Build Tools 36.0.0.
- APK installed and launched in a dedicated Android 35 AOSP arm64-v8a emulator.
- `runCompatibilitySpike()` completed all three assertions:
  `"  Android  "` returned `"Hello, Android!"`, server was `connect-rust/axum`,
  and whitespace-only input returned the SDK's typed `Code.INVALID_ARGUMENT`.
- App log: `PASS: Android greeting, server identity, and invalid_argument`.
- HTTP used official Connect binary Protobuf; no handwritten wire implementation.

[VERIFICATION.md](VERIFICATION.md) records the successful build and actual
emulator result without machine-specific scratch paths. This is a disposable
integration check, not production application architecture.

## Tooling added

Official platform-tools 37.0.1, emulator 37.2.13, and
`system-images;android-35;default;arm64-v8a` revision 2 were installed.
The existing cmdline-tools 23.0 `sdkmanager` redirected to the new Android CLI.
Installation succeeded without a license prompt or a new explicit license
acceptance action. Android SDK terms: https://developer.android.com/studio/terms
No Android Studio, new Java installation, NDK, CMake, persistent PATH change,
or security setting change was made.

## Reproduce on an Apple Silicon Mac

These tool URLs and the arm64 AVD reproduce the verified Mac setup. For Linux,
use matching official host binaries and a system image supported by that host;
a Linux or Windows emulator run has not been verified here.

The spike root contains `android/` and `proto/`. Set ROOT to that root and SDK
to an existing Android SDK. Obtain these official tools locally:

- Gradle: https://services.gradle.org/distributions/gradle-9.8.1-bin.zip
  Verify against https://services.gradle.org/distributions/gradle-9.8.1-bin.zip.sha256
  and extract under `$ROOT/tools/`.
- protoc 36.2: https://repo.maven.apache.org/maven2/com/google/protobuf/protoc/4.36.2/protoc-4.36.2-osx-aarch_64.exe
  Place at `$ROOT/tools/protoc` and make executable. The tested binary hash is in
  `verified-tools.sha256`.
- Connect generator: https://github.com/connectrpc/connect-kotlin/releases/download/v0.10.0/protoc-gen-connect-kotlin-0.10.0.jar
  Place in `android/tools/`, retrieve the same release's `sha256.txt`, and run
  `(cd android/tools && shasum -a 256 -c sha256.txt)`.

```sh
export ROOT="$PWD" SDK="$HOME/Library/Android/sdk"
printf 'sdk.dir=%s\n' "$SDK" > android/local.properties
(cd android && PATH="$ROOT/tools:$PATH" bash generate.sh)
(cd android && GRADLE_USER_HOME="$ROOT/gradle-home" \
  "$ROOT/tools/gradle-9.8.1/bin/gradle" --no-daemon --max-workers=1 assembleDebug)
mkdir -p "$ROOT/avd" "$ROOT/android-user"
printf 'no\n' | ANDROID_USER_HOME="$ROOT/android-user" ANDROID_AVD_HOME="$ROOT/avd" \
  "$SDK/cmdline-tools/23.0/bin/avdmanager" create avd \
  -n connect_dummy_api35 -k 'system-images;android-35;default;arm64-v8a' \
  -p "$ROOT/avd/connect_dummy_api35.avd" -d pixel_5
# Start the companion Rust dummy server on 127.0.0.1:4100 first, then:
bash android/run-emulator-test.sh
```

The runner requires POSIX (macOS or Linux) and Python 3.8+ with its standard
library. It uses a headless emulator with no camera/audio, 2 cores, 1536 MB RAM,
a dedicated foreground ADB server on port 5038, and exact serial `emulator-5580`.
It refuses occupied ports 5038/5580/5581 and checks tools, APK and AVD inputs
before startup. It never authorizes or connects to real USB devices.

Boot and assertion budgets are 300 and 60 seconds, respectively. Each command
and ADB startup has a 30-second deadline. Cleanup sends TERM, then KILL only if
needed, to owned process groups, with bounded waits of up to two seconds per
owned process. It does not send port-addressed kill-server or emulator-kill
commands that could affect a replacement service. The emulator/reverse disappear
when its owned process stops. Stop your separately started Rust server afterward.
Detached descendants, or descendants left after their leader exits, cannot be
safely signalled by the runner. OS-uninterruptible processes cannot be guaranteed
to terminate, but cleanup waits remain bounded. Logs are written to
`emulator.log`, `adb-server.log` and
`android/runtime.log` in the isolated workspace; they are excluded from Git.

Fast runner tests require no real SDK, AVD or service. Their synthetic listeners
need ports 5038, 5580 and 5581 free:

```sh
python3 -m unittest discover -s android -p test_run_emulator_test.py -v
```

These mock occupied ports, missing prerequisites, stalled commands, deadlines,
interruption and cleanup. They complement, not replace, the recorded real APK run.

The test's cleartext HTTP permission is confined to `src/debug/AndroidManifest.xml`.
Generated clients are regenerated locally by the verified official generator.
With AGP 9, generated Kotlin must be included in the Kotlin source directories,
not merely the Java source directories; the supplied build script handles both.

The successful run shut down all owned test processes. Dedicated AVD/source/build
files and installed SDK components remain for reuse. No existing user project or
physical device was touched. No commit, push, or deployment was performed.
