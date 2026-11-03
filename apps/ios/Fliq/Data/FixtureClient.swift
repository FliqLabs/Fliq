import Foundation

/// Serves the canonical responses in `spec/fixtures`, bundled with the app, so every screen
/// shows the same numbers as the web, the mock server and the demo.
struct FixtureClient: FliqAPI {
    var bundle: Bundle = .main
    private let progress = PayoutProgress()

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

    /// Each poll moves one step along the settled fixture's own history, so the Sending
    /// timeline plays out the way a real payout does instead of jumping to the end.
    func payout(id: String) async throws -> Payout {
        let settled: Payout = try load("payout.settled")
        let step = await progress.next(for: id)
        return settled.upTo(step: min(step, settled.history.count - 1))
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

private actor PayoutProgress {
    private var polls: [String: Int] = [:]

    func next(for id: String) -> Int {
        let step = (polls[id] ?? 0) + 1
        polls[id] = step
        return step
    }
}

private extension Payout {
    func upTo(step: Int) -> Payout {
        let history = Array(history.prefix(step + 1))
        let state = history.last?.state ?? state
        let settled = state == .settled
        return Payout(
            payoutId: payoutId, state: state, accountName: accountName, account: account,
            amount: amount, receive: receive, currency: currency, rate: rate, fees: fees,
            provider: provider, deposit: deposit,
            providerOrder: step >= 2 ? providerOrder : nil,
            vaultReceipt: step >= 1 ? vaultReceipt : nil,
            bankReference: settled ? bankReference : nil,
            seconds: settled ? seconds : nil,
            history: history
        )
    }
}
