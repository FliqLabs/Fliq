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
    case awaitingDeposit = "awaiting_deposit"
    case depositSeen = "deposit_seen"
    case payingOut = "paying_out"
    case settled
    case refused
    case refunded
    case notReceived = "not_received"

    var isFinal: Bool {
        switch self {
        case .settled, .refused, .refunded, .notReceived: true
        case .awaitingDeposit, .depositSeen, .payingOut: false
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
    let amount: String
}

struct Payout: Codable, Sendable, Equatable, Identifiable {
    let payoutId: String
    let state: PayoutState
    let accountName: String
    let account: Account
    let amount: String
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
