import Foundation

protocol FliqAPI: Sendable {
    func health() async throws -> Health
    func rate(_ token: Token, _ currency: Currency) async throws -> Rate
    func quote(_ request: QuoteRequest) async throws -> Quote
    func verify(_ account: Account) async throws -> VerifiedAccount
    func createPayout(_ request: PayoutRequest, idempotencyKey: String) async throws -> Payout
    func payout(id: String) async throws -> Payout
}

enum FliqJSON {
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }
}
