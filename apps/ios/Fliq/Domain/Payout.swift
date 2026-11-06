import Foundation

struct Account: Codable, Sendable, Equatable {
    let bank: String
    let number: String
}

struct VerifiedAccount: Codable, Sendable, Equatable {
    let bank: String
    let number: String
    let accountName: String
    let institution: String
}

enum PayoutState: String, Codable, Sendable, CaseIterable {
    case created
    case providerTimeout = "provider_timeout"
    case awaitingRecon = "awaiting_recon"
    case awaitingDeposit = "awaiting_deposit"
    case depositSeen = "deposit_seen"
    case routing
    case withProvider = "with_provider"
    case payingOut = "paying_out"
    case settled
    case refunding
    case refunded
    case expired
    case failed
    case refused
    case notReceived = "not_received"

    var isFinal: Bool {
        switch self {
        case .settled, .refunded, .expired, .failed, .refused, .notReceived: true
        default: false
        }
    }

    /// The step of the Sending timeline this state belongs to. The server has more states than the screen has rows.
    var stage: PayoutState {
        switch self {
        case .created, .providerTimeout, .awaitingRecon, .awaitingDeposit: .awaitingDeposit
        case .depositSeen, .routing: .depositSeen
        case .withProvider, .payingOut, .refunding: .payingOut
        case .expired, .failed: .refused
        default: self
        }
    }
}

struct StateChange: Codable, Sendable, Equatable {
    let state: PayoutState
    let at: Date
}

struct Deposit: Codable, Sendable, Equatable {
    let chain: String
    let address: String
    let amount: TokenAmount
}

struct Payout: Codable, Sendable, Equatable, Identifiable {
    let payoutId: String
    let state: PayoutState
    let accountName: String
    let account: Account
    let amount: TokenAmount
    let receive: Int
    let currency: Currency
    let rate: Double
    let fees: Fees
    let provider: ProviderID
    let deposit: Deposit
    let providerOrder: String?
    let vaultReceipt: String?
    let bankReference: String?
    let seconds: Int?
    let history: [StateChange]

    var id: String { payoutId }
}

struct PayoutRequest: Codable, Sendable, Equatable {
    let quoteId: String
    let account: Account
}

/// One row of `GET /payouts`, newest first.
struct PayoutSummary: Codable, Sendable, Equatable, Identifiable {
    struct Bank: Codable, Sendable, Equatable {
        let code: String
        let name: String
    }

    let payoutId: String
    let state: PayoutState
    let accountName: String
    let bank: Bank
    let accountLast4: String
    let amount: TokenAmount
    let receive: Int
    let currency: Currency
    let provider: ProviderID
    let createdAt: Date

    var id: String { payoutId }
}

struct PayoutList: Codable, Sendable, Equatable {
    let items: [PayoutSummary]
    let nextCursor: String?
}

/// Today's numbers from `GET /payouts/stats`, counted in the workspace's time zone.
struct PayoutStats: Codable, Sendable, Equatable {
    struct Window: Codable, Sendable, Equatable {
        let start: Date
        let end: Date
    }

    struct Count: Codable, Sendable, Equatable {
        struct Total: Codable, Sendable, Equatable {
            let currency: Currency
            let amount: Int
        }

        let count: Int
        let totals: [Total]
    }

    let timezone: String
    let window: Window
    let settled: Count
    let medianSecondsToBank: Double?
    let refused: Count
}
