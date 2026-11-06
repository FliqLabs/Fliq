import XCTest
@testable import Fliq

private let fixtures = FixtureClient()

/// The real client against canned HTTP: which path it calls, which token it sends,
/// and how it renews an expired session.
final class HTTPClientTests: XCTestCase {
    override func tearDown() {
        StubProtocol.reset()
    }

    func testQuotesAndAccountChecksUseTheServerPaths() async throws {
        let client = makeClient()
        StubProtocol.respond { request in
            switch request.url?.path {
            case "/v1/quotes": (200, try fixtures.data("quote.usdc-ngn-50"))
            case "/v1/accounts/verify": (200, try fixtures.data("verify.gtbank-0123456789"))
            default: (404, Data())
            }
        }

        let quote = try await client.quote(QuoteRequest(token: .usdc, currency: .ngn, amount: TokenAmount(baseUnits: 50_000_000)))
        let account = try await client.verify(Account(bank: "058", number: "0123456789"))

        XCTAssertEqual(quote.amount.baseUnits, 50_000_000)
        XCTAssertEqual(account.bank, "058")
        XCTAssertEqual(StubProtocol.requests.map(\.url?.path), ["/v1/quotes", "/v1/accounts/verify"])
    }

    func testSignInKeepsTheSessionAndSendsItsToken() async throws {
        let sessions = SessionVault(keychain: nil)
        let client = makeClient(sessions: sessions)
        StubProtocol.respond { request in
            switch request.url?.path {
            case "/v1/auth/email-links/verify": (200, try fixtures.data("session.signed-in"))
            default: (200, try fixtures.data("vault.balance"))
            }
        }

        let user = try await client.verifyEmailLink(token: "el_test")
        let balance = try await client.vaultBalance()

        let session: Session = try fixtures.load("session.signed-in")
        XCTAssertEqual(user, session.user)
        XCTAssertEqual(balance.available.decimalString, "128.18")
        XCTAssertEqual(StubProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer \(session.accessToken)")
        let needsSignIn = await client.needsSignIn
        XCTAssertFalse(needsSignIn)
    }

    func testAnExpiredTokenIsRenewedOnceAndTheCallRetried() async throws {
        let sessions = SessionVault(keychain: nil)
        let signedIn: Session = try fixtures.load("session.signed-in")
        await sessions.store(Session(accessToken: "expired", expiresIn: 0, refreshToken: "rt_old", user: signedIn.user))
        let client = makeClient(sessions: sessions)
        StubProtocol.respond { request in
            switch (request.url?.path, request.value(forHTTPHeaderField: "Authorization")) {
            case ("/v1/auth/refresh", _): (200, try fixtures.data("session.signed-in"))
            case (_, "Bearer expired"): (401, try fixtures.data("error.unauthorized"))
            default: (200, try fixtures.data("user.new"))
            }
        }

        _ = try await client.me()

        XCTAssertEqual(StubProtocol.requests.map(\.url?.path), ["/v1/me", "/v1/auth/refresh", "/v1/me"])
        let tokens = await sessions.tokens
        XCTAssertEqual(tokens?.accessToken, signedIn.accessToken)
    }

    func testARefusedRefreshSignsOut() async throws {
        let sessions = SessionVault(keychain: nil)
        let signedIn: Session = try fixtures.load("session.signed-in")
        await sessions.store(signedIn)
        let client = makeClient(sessions: sessions)
        StubProtocol.respond { _ in (401, try fixtures.data("error.unauthorized")) }

        do {
            _ = try await client.me()
            XCTFail("expected 401")
        } catch APIError.server(let status, _) {
            XCTAssertEqual(status, 401)
        }
        let needsSignIn = await client.needsSignIn
        XCTAssertTrue(needsSignIn)
    }

    func testSignInLinksAreReadFromAnyForm() {
        XCTAssertEqual(SignInFlow.token(in: "https://fliq.cash/auth/verify?token=el_abc-123"), "el_abc-123")
        XCTAssertEqual(SignInFlow.token(in: "fliq://auth/verify?token=el_abc"), "el_abc")
        XCTAssertEqual(SignInFlow.token(in: "  el_abc\n"), "el_abc")
        XCTAssertNil(SignInFlow.token(in: "hello there"))
        XCTAssertNil(SignInFlow.token(in: "https://fliq.cash/auth/verify"))
    }

    private func makeClient(sessions: SessionVault = SessionVault(keychain: nil)) -> HTTPClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return HTTPClient(
            baseURL: URL(string: "https://api.test/v1")!,
            apiKey: "rt_test",
            sessions: sessions,
            session: URLSession(configuration: configuration)
        )
    }
}

private final class StubProtocol: URLProtocol, @unchecked Sendable {
    typealias Responder = @Sendable (URLRequest) throws -> (Int, Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var responder: Responder = { _ in (500, Data()) }
    nonisolated(unsafe) private static var seen: [URLRequest] = []

    static var requests: [URLRequest] { lock.withLock { seen } }

    static func respond(_ responder: @escaping Responder) {
        lock.withLock { self.responder = responder }
    }

    static func reset() {
        lock.withLock {
            responder = { _ in (500, Data()) }
            seen = []
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let respond = Self.lock.withLock {
            Self.seen.append(request)
            return Self.responder
        }
        do {
            let (status, data) = try respond(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
