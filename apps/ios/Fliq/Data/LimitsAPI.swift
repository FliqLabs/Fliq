import Foundation

struct HTTPLimitsAPI: LimitsAPI {
    let client: HTTPClient

    // The key must be sent as null to remove the limit, so it is encoded by hand.
    private struct Change: Encodable {
        let dailyLimit: String?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(dailyLimit, forKey: .dailyLimit)
        }

        enum CodingKeys: String, CodingKey { case dailyLimit }
    }

    func limits() async throws -> Limits {
        try await client.send("GET", "me/limits")
    }

    func setDailyLimit(_ dollars: String?) async throws -> Limits {
        try await client.send("PUT", "me/limits", body: Change(dailyLimit: dollars))
    }

    func cancelPendingLimit() async throws -> Limits {
        try await client.send("DELETE", "me/limits/pending")
    }
}

/// Follows the API's rules in memory, for previews, tests and the sample-data build.
actor FixtureLimitsAPI: LimitsAPI {
    static let raiseDelay: TimeInterval = 24 * 60 * 60

    private var limit: TokenAmount?
    private var pending: (limit: TokenAmount?, at: Date)?
    private let spent: TokenAmount
    private let now: @Sendable () -> Date

    init(limit: TokenAmount? = nil, spent: TokenAmount = .zero, now: @escaping @Sendable () -> Date = { .now }) {
        self.limit = limit
        self.spent = spent
        self.now = now
    }

    func limits() async throws -> Limits { view() }

    func setDailyLimit(_ dollars: String?) async throws -> Limits {
        let wanted = try dollars.map { text -> TokenAmount in
            guard let amount = TokenAmount(decimalString: text) else { throw APIError.unexpected(status: 400) }
            return amount
        }
        mature()
        pending = nil
        if let current = limit, wanted.map({ $0 > current }) ?? true {
            pending = (wanted, now().addingTimeInterval(Self.raiseDelay))
        } else {
            limit = wanted
        }
        return view()
    }

    func cancelPendingLimit() async throws -> Limits {
        mature()
        pending = nil
        return view()
    }

    private func mature() {
        guard let waiting = pending, waiting.at <= now() else { return }
        limit = waiting.limit
        pending = nil
    }

    private func view() -> Limits {
        mature()
        let left = limit.map { $0 > spent ? TokenAmount(baseUnits: $0.baseUnits - spent.baseUnits) : .zero }
        return Limits(
            dailyLimit: limit?.decimalString,
            spentToday: spent.decimalString,
            remaining: left?.decimalString,
            pending: pending.map { Limits.Pending(dailyLimit: $0.limit?.decimalString, effectiveAt: $0.at) }
        )
    }
}
