import CompatibilitySpike

@main
struct CompatibilitySpikeCLI {
    static func main() async throws {
        print(try await runCompatibilitySpike())
    }
}
