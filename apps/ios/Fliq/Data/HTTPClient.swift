import Foundation

struct HTTPClient: FliqAPI {
    let baseURL: URL
    let apiKey: String
    var session: URLSession = .shared

    func health() async throws -> Health {
        try await send("GET", "health")
    }

    func rate(_ token: Token, _ currency: Currency) async throws -> Rate {
        try await send("GET", "rates/\(token.rawValue)/\(currency.rawValue)")
    }

    func quote(_ request: QuoteRequest) async throws -> Quote {
        try await send("POST", "quote", body: request)
    }

    func verify(_ account: Account) async throws -> VerifiedAccount {
        try await send("POST", "institutions/verify", body: account)
    }

    func createPayout(_ request: PayoutRequest, idempotencyKey: String) async throws -> Payout {
        try await send("POST", "payouts", body: request, headers: ["Idempotency-Key": idempotencyKey])
    }

    func payout(id: String) async throws -> Payout {
        try await send("GET", "payouts/\(id)")
    }

    private func send<Response: Decodable>(
        _ method: String,
        _ path: String,
        body: (any Encodable)? = nil,
        headers: [String: String] = [:]
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try FliqJSON.encoder().encode(body)
        }

        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let decoder = FliqJSON.decoder()

        guard (200..<300).contains(status) else {
            if status == 422, let refusal = try? decoder.decode(Refusal.self, from: data) {
                throw APIError.refused(refusal)
            }
            if let body = try? decoder.decode(ErrorBody.self, from: data) {
                throw APIError.server(status: status, body.error)
            }
            throw APIError.unexpected(status: status)
        }
        return try decoder.decode(Response.self, from: data)
    }
}
