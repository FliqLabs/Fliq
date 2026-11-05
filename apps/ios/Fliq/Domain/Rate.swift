import Foundation

enum Token: String, Codable, Sendable {
    case usdc, usdt
}

enum Currency: String, Codable, Sendable {
    case ngn, kes

    var symbol: String {
        switch self {
        case .ngn: "₦"
        case .kes: "KSh"
        }
    }
}

enum ProviderID: String, Codable, Sendable {
    case paycrest, busha, fonbnk, bitnob, transfi
    /// The API's sandbox provider, which pays nobody. Local and sandbox servers quote with it.
    case mock

    var displayName: String { self == .mock ? "Sandbox" : rawValue.capitalized }
}

struct ReferenceRate: Codable, Sendable, Equatable {
    let source: String
    let rate: Double
}

struct Rate: Codable, Sendable, Equatable {
    let token: Token
    let currency: Currency
    let rate: Double
    let rateBeforeFees: Double
    let provider: ProviderID
    let providersQuoting: Int
    let spread: Double
    let official: ReferenceRate
    let p2p: ReferenceRate
    let change24h: Double
    let fetchedAt: Date

    // convertFromSnakeCase turns "change_24h" into "change24H", so that key is spelled out.
    enum CodingKeys: String, CodingKey {
        case token, currency, rate, rateBeforeFees, provider, providersQuoting, spread, official, p2p, fetchedAt
        case change24h = "change24H"
    }
}

struct Health: Codable, Sendable, Equatable {
    let status: String
    let version: String
}
