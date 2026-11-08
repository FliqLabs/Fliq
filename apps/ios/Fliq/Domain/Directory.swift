import Foundation

/// A bank or mobile money operator a payout can land at, from `GET /institutions`.
struct Institution: Codable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable {
        case bank
        case mobileMoney = "mobile_money"
    }

    let code: String
    let name: String
    var type: Kind = .bank
    var country: Country = .ng
    var logoKey: String?

    /// Shown before `GET /institutions` answers, and when it can't be reached.
    static let supported = [Institution(code: "058", name: "GTBank", logoKey: "gtbank")]

    static func name(for code: String, in list: [Institution] = supported) -> String? {
        list.first { $0.code == code }?.name
    }
}

struct InstitutionList: Codable, Sendable, Equatable {
    let items: [Institution]
}

/// A bank account saved for paying again. The full number stays with the API.
struct Recipient: Codable, Sendable, Equatable, Identifiable {
    struct Bank: Codable, Sendable, Equatable {
        let code: String
        let name: String
        let logoKey: String?
    }

    let recipientId: String
    let accountName: String
    let bank: Bank
    let accountLast4: String
    let createdAt: Date

    var id: String { recipientId }
}

struct RecipientList: Codable, Sendable, Equatable {
    let items: [Recipient]
}

/// `GET /vault`: the signed-in user's balance as the API last read it from the contract.
struct VaultBalance: Codable, Sendable, Equatable {
    let account: String
    let available: TokenAmount
    let reserved: TokenAmount
    let total: TokenAmount
    let inSync: Bool
}

/// Another fliq user, found by name.
struct Person: Codable, Sendable, Equatable {
    let nearAccount: String
    let displayName: String?
    let photoUrl: String?
    let memberSince: Date
}

struct RecentPerson: Codable, Sendable, Hashable, Identifiable {
    let nearAccount: String
    let displayName: String?
    let photoUrl: String?
    let memberSince: Date
    let lastPaidAt: Date?

    var id: String { nearAccount }
}

struct RecentPeopleList: Codable, Sendable, Equatable {
    let items: [RecentPerson]
}

/// A country fliq pays out in. The raw value is the API's `country` code.
enum Country: String, Codable, CaseIterable, Sendable {
    case ng, ke

    var name: String {
        switch self {
        case .ng: "Nigeria"
        case .ke: "Kenya"
        }
    }

    var flag: String {
        switch self {
        case .ng: "🇳🇬"
        case .ke: "🇰🇪"
        }
    }

    var currency: Currency {
        switch self {
        case .ng: .ngn
        case .ke: .kes
        }
    }

    /// NUBAN numbers are exactly 10 digits. Kenyan bank accounts run longer, and M-Pesa takes a 10 digit phone number.
    var numberLengths: ClosedRange<Int> {
        switch self {
        case .ng: 10...10
        case .ke: 10...14
        }
    }
}
