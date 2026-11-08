import Foundation

/// The real API. Signed-in calls carry the session's access token; when it has expired the client
/// renews it once with the refresh token and retries. Before sign-in, `apiKey` is sent instead,
/// which is what `make dev-mock` accepts.
struct HTTPClient: FliqAPI {
    let baseURL: URL
    let apiKey: String
    var sessions = SessionVault()
    var session: URLSession = .shared
    /// Sent as `X-Device-Name`, so Devices and sessions can tell this phone from a browser.
    var deviceName = "iPhone"
    /// How long to wait before asking again while the server is still creating the NEAR account. The wait grows
    /// with each try, up to five times this, so the tries span about 90 seconds: a sleeping relayer takes about a
    /// minute to wake.
    var claimRetryDelay: Duration = .seconds(2)
    static let claimAttempts = 12

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

    func passkeyOptions(_ purpose: PasskeyPurpose) async throws -> PasskeyOptions {
        try await send("POST", "auth/passkeys/\(purpose.rawValue)/options")
    }

    func finishPasskey(_ purpose: PasskeyPurpose, challengeId: String, credential: Data) async throws -> User {
        let response = try JSONSerialization.jsonObject(with: credential)
        let body = try JSONSerialization.data(withJSONObject: ["challenge_id": challengeId, "credential": response])
        let signedIn: Session = try await send("POST", "auth/passkeys/\(purpose.rawValue)/verify", body: PreEncoded(data: body))
        await sessions.store(signedIn)
        return signedIn.user
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

    /// A 202 means the account is still being created; the same request with the same key finishes it.
    /// A 503 is usually the relayer waking up, and the same claim a moment later goes through.
    func claimName(_ name: FliqName, publicKey: String) async throws -> User {
        let body = ClaimNameRequest(name: name.value, publicKey: publicKey)
        let headers = ["Idempotency-Key": "claim-\(name.value)"]
        for attempt in 1...Self.claimAttempts {
            let (data, status) = try await exchange("POST", "me/name", body: body, headers: headers)
            let retry = status == 202 || status == 503
            if status == 202, attempt == Self.claimAttempts { break }
            guard retry, attempt < Self.claimAttempts else { return try decode(data, status: status) }
            try await Task.sleep(for: claimRetryDelay * min(attempt, 5))
        }
        throw APIError.unexpected(status: 202)
    }

    func updateProfile(displayName: String) async throws -> User {
        try await send("PATCH", "me", body: ["display_name": displayName])
    }

    func institutions(in country: Country) async throws -> [Institution] {
        let list: InstitutionList = try await send("GET", "institutions", query: ["country": country.rawValue])
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

    func relay(signedDelegate: String) async throws -> RelayResult {
        try await send("POST", "relays", body: ["signed_delegate": signedDelegate])
    }

    func relayResult(hash: String) async throws -> RelayResult {
        try await send("GET", "relays/\(hash)")
    }

    func passkeys() async throws -> PasskeyList {
        try await send("GET", "passkeys")
    }

    func deviceSessions() async throws -> DeviceSessionList {
        try await send("GET", "sessions")
    }

    func createRequest(_ input: PaymentRequestInput, idempotencyKey: String) async throws -> PaymentRequest {
        try await send("POST", "requests", body: input, headers: ["Idempotency-Key": idempotencyKey])
    }

    func request(id: String) async throws -> PaymentRequest {
        try await send("GET", "requests/\(id)")
    }

    func revokeSession(id: String) async throws {
        let _: Empty = try await send("DELETE", "sessions/\(id)")
    }

    func send<Response: Decodable>(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: (any Encodable)? = nil,
        headers: [String: String] = [:]
    ) async throws -> Response {
        let (data, status) = try await exchange(method, path, query: query, body: body, headers: headers)
        return try decode(data, status: status)
    }

    /// The body as sent, for answers that carry JSON the app must pass on byte for byte, such as call args to sign.
    func sendRaw(
        _ method: String,
        _ path: String,
        body: (any Encodable)? = nil,
        headers: [String: String] = [:]
    ) async throws -> Data {
        let (data, status) = try await exchange(method, path, body: body, headers: headers)
        if !(200..<300).contains(status) { let _: Empty = try decode(data, status: status) }
        return data
    }

    private func decode<Response: Decodable>(_ data: Data, status: Int) throws -> Response {
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

    /// One request, renewing the access token first when it is about to run out, and once more after a 401.
    private func exchange(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: (any Encodable)?,
        headers: [String: String]
    ) async throws -> (Data, Int) {
        let signedIn = !path.hasPrefix("auth/")
        var bearer = await sessions.tokens?.accessToken
        if signedIn, await sessions.needsRenewal() {
            bearer = await sessions.renewedToken(replacing: bearer, with: refresh) ?? bearer
        }
        let first = try await perform(method, path, query: query, body: body, headers: headers, bearer: bearer ?? apiKey)
        guard first.1 == 401, signedIn, bearer != nil else { return first }

        guard let renewed = await sessions.renewedToken(replacing: bearer, with: refresh) else { return first }
        return try await perform(method, path, query: query, body: body, headers: headers, bearer: renewed)
    }

    /// Nil when the API refuses the refresh token; throws when it could not be reached or failed.
    private var refresh: @Sendable (String) async throws -> Session? {
        { refreshToken in
            let (data, status) = try await perform("POST", "auth/refresh", body: ["refresh_token": refreshToken], headers: [:], bearer: nil)
            if status == 401 || status == 403 { return nil }
            guard status == 200 else { throw APIError.unexpected(status: status) }
            return try FliqJSON.decoder().decode(Session.self, from: data)
        }
    }

    private func perform(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: (any Encodable)?,
        headers: [String: String],
        bearer: String?
    ) async throws -> (Data, Int) {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let bearer, !bearer.isEmpty { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.setValue(deviceName, forHTTPHeaderField: "X-Device-Name")
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try (body as? PreEncoded)?.data ?? FliqJSON.encoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

private struct ClaimNameRequest: Encodable {
    let name: String
    let publicKey: String
}

/// The body of a 204.
struct Empty: Decodable, Sendable {}

/// A body that is already JSON. WebAuthn's camelCase keys (rawId, clientDataJSON) must not be snake_cased.
private struct PreEncoded: Encodable {
    let data: Data

    func encode(to encoder: Encoder) throws {}
}
