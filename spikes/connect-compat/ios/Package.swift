// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CompatibilitySpike",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "CompatibilitySpike", targets: ["CompatibilitySpike"]),
        .executable(name: "compatibility-spike", targets: ["CompatibilitySpikeCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/connectrpc/connect-swift.git", exact: "1.2.3"),
        .package(url: "https://github.com/apple/swift-protobuf.git", exact: "1.31.0"),
    ],
    targets: [
        .target(name: "CompatibilitySpike", dependencies: [
            .product(name: "Connect", package: "connect-swift"),
            .product(name: "SwiftProtobuf", package: "swift-protobuf"),
        ]),
        .executableTarget(name: "CompatibilitySpikeCLI", dependencies: ["CompatibilitySpike"]),
    ]
)
