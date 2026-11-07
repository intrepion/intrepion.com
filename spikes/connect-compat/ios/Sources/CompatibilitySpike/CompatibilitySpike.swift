import Connect
import SwiftProtobuf

public enum CompatibilitySpikeError: Error {
    case unexpectedGreeting
    case unexpectedServer
    case expectedInvalidArgument
}

/// Shared SDK check; the CLI exercises macOS, not an iOS simulator.
public func runCompatibilitySpike() async throws -> String {
    let client = SpikeV1CompatibilityServiceClient(client: ProtocolClient(config: .init(
        host: "http://127.0.0.1:4100",
        networkProtocol: .connect,
        codec: ProtoCodec(),
        timeout: 10
    )))
    let response = await client.ping(request: SpikeV1PingRequest.with { $0.clientName = "  Swift  " })
    let reply = try response.result.get()
    guard reply.message == "Hello, Swift!" else { throw CompatibilitySpikeError.unexpectedGreeting }
    guard reply.server == "connect-rust/axum" else { throw CompatibilitySpikeError.unexpectedServer }
    let invalid = await client.ping(request: SpikeV1PingRequest.with { $0.clientName = "  " })
    guard invalid.error?.code == .invalidArgument else {
        throw CompatibilitySpikeError.expectedInvalidArgument
    }
    return "PASS: Swift SDK greeting, server identity, and invalid_argument"
}
