import Foundation

struct Fees: Codable, Sendable, Equatable {
    let provider: Int
    let network: Int
    let total: Int
}

struct Route: Codable, Sendable, Equatable {
    enum Status: String, Codable, Sendable {
        case live, stale, paused
    }

    let provider: ProviderID
    let status: Status
    let rate: Double?
    let ageSeconds: Int?
    let routed: Bool?
}

struct Quote: Codable, Sendable, Equatable {
    let quoteId: String
    let token: Token
    let currency: Currency
    let amount: TokenAmount
    let rateBeforeFees: Double
    let fees: Fees
    let rate: Double
    let receive: Int
    let provider: ProviderID
    let bestOf: Int
    let routes: [Route]
    let expiresIn: Int
}

struct QuoteRequest: Codable, Sendable, Equatable {
    let token: Token
    let currency: Currency
    let amount: TokenAmount
}
