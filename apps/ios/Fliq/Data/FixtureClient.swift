import Foundation

/// Serves the canonical responses in `spec/fixtures`, bundled with the app, so every screen
/// shows the same numbers as the web, the mock server and the demo.
struct FixtureClient: FliqAPI {
    var bundle: Bundle = .main

    func health() async throws -> Health {
        try load("health")
    }

    func rate(_ token: Token, _ currency: Currency) async throws -> Rate {
        try load("rate.usdc-ngn")
    }

    func quote(_ request: QuoteRequest) async throws -> Quote {
        try load("quote.usdc-ngn-50")
    }

    func verify(_ account: Account) async throws -> VerifiedAccount {
        try load("verify.gtbank-0123456789")
    }

    func createPayout(_ request: PayoutRequest, idempotencyKey: String) async throws -> Payout {
        try load("payout.created")
    }

    func payout(id: String) async throws -> Payout {
        try load("payout.settled")
    }

    func load<Value: Decodable>(_ name: String) throws -> Value {
        try FliqJSON.decoder().decode(Value.self, from: data(name))
    }

    func data(_ name: String) throws -> Data {
        guard let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "fixtures") else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: "fixtures/\(name).json"])
        }
        return try Data(contentsOf: url)
    }
}
