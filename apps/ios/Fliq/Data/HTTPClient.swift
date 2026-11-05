import Foundation

/// The real API. Signed-in calls carry the session's access token; when it has expired the client
/// renews it once with the refresh token and retries. Before sign-in, `apiKey` is sent instead,
/// which is what `make dev-mock` accepts.
struct HTTPClient: FliqAPI {
    let baseURL: URL
    let apiKey: String
    var sessions = SessionVault()
    var session: URLSession = .shared

    func health() async throws -> Health {
        try await send("GET", "health")
    }

    func rate(_ token: Token, _ currency: Currency) async throws -> Rate {
        try await send("GET", "rates/\(token.rawValue)/\(currency.rawValue)")
    }

    func quote(_ request: QuoteRequest) async throws -> Quote {
        try await send("POST", "quotes", body: request)
    }

    func verify(_ account: Account) async throws -> VerifiedAccount {
        try await send("POST", "accounts/verify", body: account)
    }

    func createPayout(_ request: PayoutRequest, idempotencyKey: String) async throws -> Payout {
        try await send("POST", "payouts", body: request, headers: ["Idempotency-Key": idempotencyKey])
    }

    func payout(id: String) async throws -> Payout {
        try await send("GET", "payouts/\(id)")
    }

    func payouts() async throws -> PayoutList {
        try await send("GET", "payouts")
    }

    var needsSignIn: Bool {
        get async { await !sessions.isSignedIn }
    }

    func sendEmailLink(to email: String) async throws -> EmailLinkSent {
        try await send("POST", "auth/email-links", body: ["email": email])
    }

    func verifyEmailLink(token: String) async throws -> User {
        let signedIn: Session = try await send("POST", "auth/email-links/verify", body: ["token": token])
        await sessions.store(signedIn)
        return signedIn.user
    }

    func signOut() async {
        _ = try? await send("POST", "auth/logout") as Empty
        await sessions.clear()
    }

    func me() async throws -> User {
        try await send("GET", "me")
    }

    func checkName(_ name: FliqName) async throws -> NameAvailability {
        try await send("GET", "names/\(name.value)")
    }

    func claimName(_ name: FliqName) async throws -> User {
        try await send("POST", "me/name", body: ["name": name.value], headers: ["Idempotency-Key": "claim-\(name.value)"])
    }

    func updateProfile(displayName: String) async throws -> User {
        try await send("PATCH", "me", body: ["display_name": displayName])
    }

    func institutions() async throws -> [Institution] {
        let list: InstitutionList = try await send("GET", "institutions")
        return list.items
    }

    func vaultBalance() async throws -> VaultBalance {
        try await send("GET", "vault")
    }

    func recipients() async throws -> RecipientList {
        try await send("GET", "recipients")
    }

    func recentPeople() async throws -> RecentPeopleList {
        try await send("GET", "people/recent")
    }

    func person(named name: String) async throws -> Person {
        try await send("GET", "people/\(name)")
    }

    private func send<Response: Decodable>(
        _ method: String,
        _ path: String,
        body: (any Encodable)? = nil,
        headers: [String: String] = [:]
    ) async throws -> Response {
        let (data, status) = try await exchange(method, path, body: body, headers: headers)
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
        if Response.self == Empty.self, let empty = Empty() as? Response { return empty }
        return try decoder.decode(Response.self, from: data)
    }

    /// One request, plus one retry with a renewed token when the access token was refused.
    private func exchange(
        _ method: String,
        _ path: String,
        body: (any Encodable)?,
        headers: [String: String]
    ) async throws -> (Data, Int) {
        let tokens = await sessions.tokens
        let first = try await perform(method, path, body: body, headers: headers, bearer: tokens?.accessToken ?? apiKey)
        guard first.1 == 401, let tokens, !path.hasPrefix("auth/") else { return first }

        guard let renewed = try await renew(tokens.refreshToken) else {
            await sessions.clear()
            return first
        }
        return try await perform(method, path, body: body, headers: headers, bearer: renewed)
    }

    private func renew(_ refreshToken: String) async throws -> String? {
        let (data, status) = try await perform("POST", "auth/refresh", body: ["refresh_token": refreshToken], headers: [:], bearer: nil)
        guard status == 200, let renewed = try? FliqJSON.decoder().decode(Session.self, from: data) else { return nil }
        await sessions.store(renewed)
        return renewed.accessToken
    }

    private func perform(
        _ method: String,
        _ path: String,
        body: (any Encodable)?,
        headers: [String: String],
        bearer: String?
    ) async throws -> (Data, Int) {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        if let bearer, !bearer.isEmpty { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try FliqJSON.encoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

/// The body of a 204.
struct Empty: Decodable, Sendable {}
