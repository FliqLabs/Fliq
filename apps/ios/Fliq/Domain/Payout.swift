import Foundation

struct Account: Codable, Sendable, Equatable {
    let bank: String
    let number: String
}

struct VerifiedAccount: Codable, Sendable, Hashable {
    let bank: String
    let number: String
    let accountName: String
    let institution: String
    /// Not part of the API's answer. The app records the country it asked about, so a saved account is paid in its own
    /// currency, and the institution's logo.
    var country: Country?
    var logoKey: String?
    /// The account as saved on the server. Its number may be only "••••1234": the server keeps the full one and a
    /// payout names it by this id instead.
    var recipientId: String?

    var currency: Currency { (country ?? .ng).currency }

    /// False for an account restored from the server, which shows only its last four digits.
    var hasFullNumber: Bool { !number.isEmpty && number.allSatisfy(\.isNumber) }

    /// The same account, however much of its number each side knows.
    func isSame(as other: VerifiedAccount) -> Bool {
        if let recipientId, recipientId == other.recipientId { return true }
        return bank == other.bank && number.suffix(4) == other.number.suffix(4)
    }

    init(bank: String, number: String, accountName: String, institution: String, country: Country? = nil, logoKey: String? = nil, recipientId: String? = nil) {
        self.bank = bank
        self.number = number
        self.accountName = accountName
        self.institution = institution
        self.country = country
        self.logoKey = logoKey
        self.recipientId = recipientId
    }

    init(_ recipient: Recipient) {
        self.init(
            bank: recipient.bank.code, number: "••••" + recipient.accountLast4, accountName: recipient.accountName,
            institution: recipient.bank.name, country: recipient.country.flatMap(Country.init(rawValue:)) ?? .ng,
            logoKey: recipient.bank.logoKey, recipientId: recipient.recipientId
        )
    }
}

/// `POST /recipients`: confirm an account with the bank and save it on the server.
struct RecipientInput: Encodable, Sendable {
    let bank: String
    let number: String
    let country: String
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
    /// Exactly one of these: the account itself, or a saved one by its id.
    var account: Account?
    var recipientId: String?

    init(quoteId: String, account: Account) {
        self.quoteId = quoteId
        self.account = account
    }

    init(quoteId: String, recipientId: String) {
        self.quoteId = quoteId
        self.recipientId = recipientId
    }

    /// By number when this iPhone knows it, by id when it only has the server's last four digits.
    init(quoteId: String, to verified: VerifiedAccount) {
        if !verified.hasFullNumber, let id = verified.recipientId {
            self.init(quoteId: quoteId, recipientId: id)
        } else {
            self.init(quoteId: quoteId, account: Account(bank: verified.bank, number: verified.number))
        }
    }
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

/// `POST /relays` and `GET /relays/{delegateHash}`: what happened to a delegate the phone signed.
struct RelayResult: Codable, Sendable, Equatable {
    enum Status: String, Codable, Sendable {
        case succeeded, failed, pending
    }

    let status: Status
    let txHash: String?
    let delegateHash: String
    let senderId: String
    let receiverId: String
    var failures: [String]?
}
