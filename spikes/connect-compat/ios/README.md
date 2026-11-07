# Swift SDK compatibility sample

A Swift package containing an async compatibility-check function and a macOS CLI.
The same library can be called from an iOS simulator host app. It uses Connect-Swift **1.2.3**, SwiftProtobuf **1.31.0**, the
Connect protocol, and binary Protobuf. It is **not a complete iOS application**.

On 2026-11-07, official local code generation, dependency resolution, compilation,
and binary Protobuf RPC assertions passed on an Apple Silicon Mac using Swift
6.4.2, Xcode 27.2, and protoc 34.1. The CLI reached the same local Rust/Axum
service used by the web tests and checked the greeting, server identity, and
typed `invalidArgument` error. This proves the Swift SDK on **macOS only**.
An iOS Simulator-target build and user-approved runtime retry also passed on
iOS18.4. See [the simulator report](IOS_SIMULATOR_CHECK.md). This is a headless
SDK probe; no iOS GUI app lifecycle, physical-device, or production networking
verification is claimed.

## Local generation on a Mac

With Xcode/Swift and protoc installed (protoc 34.1 was verified on the Mac), run from
this directory. Official source checkouts and generated outputs stay project-local:

```sh
git clone --depth 1 --branch 1.2.3 https://github.com/connectrpc/connect-swift.git tools/connect-swift
git clone --depth 1 --branch 1.31.0 https://github.com/apple/swift-protobuf.git tools/swift-protobuf
swift build --package-path tools/connect-swift -c release --product protoc-gen-connect-swift
swift build --package-path tools/swift-protobuf -c release --product protoc-gen-swift
export PATH="$PWD/tools/connect-swift/.build/release:$PWD/tools/swift-protobuf/.build/release:$PATH"
./generate.sh
swift build
# With the sibling Rust service listening on 127.0.0.1:4100:
swift run compatibility-spike
```

The official local generators read `../proto/spike/v1/compatibility.proto`.
No schema is uploaded to a remote generator. The package intentionally requires
this generation step rather than checking in fabricated generated stubs.
Expected output: `PASS: Swift SDK greeting, server identity, and invalid_argument`.
`swift run compatibility-spike` checks macOS only; it does not establish iOS compatibility.
Use a current Xcode toolchain compatible with the pinned dependencies.

## Simulator run

Add this directory as a local Swift package to a disposable iOS 15+ SwiftUI app,
link the `CompatibilitySpike` product, and call it from a `Task`:

```swift
import CompatibilitySpike

Task {
    do { print(try await runCompatibilitySpike()) }
    catch { print("FAIL: \(error)") }
}
```

Start the Axum service on the **same Mac** as the simulator. The simulator reaches
its host at `http://127.0.0.1:4100`. If the server is running on `alarm` instead,
run it locally on the Mac for this test; no LAN exposure is needed. A physical
iPhone's loopback is not the Mac and is outside this sample's scope.

If the debug host app's App Transport Security policy blocks local HTTP, add
`NSAppTransportSecurity` → `NSAllowsLocalNetworking` = YES to its debug Info.plist.
Keep any development exception out of production. Do not broadly disable ATS.

The function throws on a wrong greeting, server identity, or missing typed
`invalidArgument` error. Only its returned PASS string represents successful
execution. Names and responses are dummy data; there is no authentication,
account data, or storage.

## Official sources checked

- [Pinned runtime and generator release](https://github.com/connectrpc/connect-swift/releases/tag/1.2.3)
- [Package dependencies](https://github.com/connectrpc/connect-swift/blob/1.2.3/Package.swift)
- [ProtocolClientConfig](https://github.com/connectrpc/connect-swift/blob/1.2.3/Libraries/Connect/Public/Interfaces/ProtocolClientConfig.swift)
- [ProtocolClient](https://github.com/connectrpc/connect-swift/blob/1.2.3/Libraries/Connect/Public/Implementation/Clients/ProtocolClient.swift)
- [Generator naming and swift_prefix](https://github.com/connectrpc/connect-swift/blob/1.2.3/Plugins/ConnectPluginUtilities/ServiceDescriptor%2BExtensions.swift)
- [SwiftProtobuf](https://github.com/apple/swift-protobuf/tree/1.31.0)
