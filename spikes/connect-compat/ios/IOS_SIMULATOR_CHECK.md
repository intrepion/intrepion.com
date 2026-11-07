# iOS simulator check (2026-11-07)

## Result

**PASS on the user-approved retry.** Xcode first-launch setup completed and the
Swift ConnectRPC probe compiled for iOS Simulator. After the user reduced
background apps, the same iOS-target binary ran inside iOS 18.4 Simulator,
returned the expected greeting and server identity, and verified
`invalid_argument`. The first stalled attempt is historical, not the current result.

## Setup and build evidence

- Xcode 27.2; selected developer directory unchanged.
- Bundled license EA2002 matched the already accepted system license. No new
  agreement, optional component download, or simulator runtime download.
- `xcodebuild -checkFirstLaunchStatus`: 69 before setup, 0 afterward.
- Approved `xcodebuild -runFirstLaunch`: exit 0, `Install Succeeded`, for bundled
  CoreTypes.pkg, MobileDevice.pkg and XcodeSystemResources.pkg.
- Existing iOS 18.4 (22E238) runtime: available, signature Verified, state Ready.
- Official Connect 1.2.3 / SwiftProtobuf 1.31.0 package: simulator build exit 0.

Equivalent build command from the spike directory after local Swift generation:

```sh
xcrun swift build --package-path ios \
  --scratch-path /tmp/connect-spike-ios-build \
  --triple arm64-apple-ios15.0-simulator \
  --sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  --product compatibility-spike --disable-automatic-resolution
```

The SDK resolved to Xcode's iPhoneSimulator27.2.sdk. Build output was
`out/Products/Debug-iphonesimulator/compatibility-spike` under the scratch path.
`file` identified Mach-O 64-bit arm64; `xcrun vtool -show-build` reported platform
IOSSIMULATOR and minos 15.0 (its SDK field also read 15.0). This is an iOS-target
build, not a macOS build. It reuses the generated official Swift SDK client and
shared greeting/server-identity/invalid_argument checks.

## Initial runtime attempt (superseded by successful retry)

Created a dedicated headless iPhone 16 on the existing iOS 18.4 runtime.
`simctl bootstatus -b` completed in 47 seconds. Started the dummy Axum service
bound only to 127.0.0.1:4100, then attempted to launch the probe using
`xcrun simctl spawn` with that simulator's UDID and the iOS-target binary.

The probe remained in `xpcproxy_sim`, as did many simulator system services and a
separate basic process-launch diagnostic. No Swift assertion, PASS output or RPC
result occurred. One-minute host load reached 398 and free memory fell to 29%,
so the test was stopped instead of adding more contention. This does not
establish a root cause or prove a ConnectRPC failure. The existing runtime may
have been unhealthy/incompatible with the newer CoreSimulator or affected by
startup/resource contention.

Cleanup was verified: owned server stopped, port 4100 free, owned simulator shut
down and removed, no booted devices, and all preexisting devices preserved. The
stalled spawn returned operation canceled during shutdown. A bounded recheck
found no remaining xpcproxy_sim or owned test processes, with memory recovered
to 42% free and load averages decreasing. No security/developer-directory
settings, sign-ins or existing user projects were changed.

## Successful user-approved retry

Baseline CPU was 70% idle, free memory 60%, and one-minute load 6.27. A fresh
disposable iPhone 16 on the installed iOS 18.4 runtime booted in 26 seconds.
The same compiled iOS-target probe ran through `simctl spawn` against the
loopback-only Axum service and printed:

```text
PASS: Swift SDK greeting, server identity, and invalid_argument
```

The process exited 0. The run used bounded boot/launch windows and resource
monitoring. This verifies actual iOS simulator SDK execution, successful response
handling and typed validation errors. It does not verify a GUI app bundle,
UIKit/SwiftUI lifecycle, physical device, production networking or authentication.

The owned server stopped and disposable simulator was shut down and removed.
No booted simulators or owned probe processes remained; port 4100 was free.
Preexisting devices were preserved. No downloads, additional setup, security
changes or new agreements were needed for the retry.
