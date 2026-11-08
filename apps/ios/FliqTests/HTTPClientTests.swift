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

    func testARefusedTokenIsRenewedOnceAndTheCallRetried() async throws {
        let sessions = SessionVault(keychain: nil)
        let signedIn: Session = try fixtures.load("session.signed-in")
        await sessions.store(Session(accessToken: "expired", expiresIn: 3600, refreshToken: "rt_old", user: signedIn.user))
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

    func testATokenAboutToRunOutIsRenewedBeforeTheCall() async throws {
        let sessions = SessionVault(keychain: nil)
        let signedIn: Session = try fixtures.load("session.signed-in")
        await sessions.store(Session(accessToken: "nearly-gone", expiresIn: 10, refreshToken: "rt_old", user: signedIn.user))
        let client = makeClient(sessions: sessions)
        StubProtocol.respond { request in
            request.url?.path == "/v1/auth/refresh" ? (200, try fixtures.data("session.signed-in")) : (200, try fixtures.data("user.new"))
        }

        _ = try await client.me()

        XCTAssertEqual(StubProtocol.requests.map(\.url?.path), ["/v1/auth/refresh", "/v1/me"])
        XCTAssertEqual(StubProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer \(signedIn.accessToken)")
    }

    /// The API revokes the whole session family when a refresh token is spent twice, so this once signed users out.
    func testCallsRefusedTogetherShareOneRenewal() async throws {
        let sessions = SessionVault(keychain: nil)
        let signedIn: Session = try fixtures.load("session.signed-in")
        await sessions.store(Session(accessToken: "stale", expiresIn: 3600, refreshToken: "rt_old", user: signedIn.user))
        let client = makeClient(sessions: sessions)
        StubProtocol.respond { request in
            switch (request.url?.path, request.value(forHTTPHeaderField: "Authorization")) {
            case ("/v1/auth/refresh", _):
                let earlier = StubProtocol.requests.filter { $0.url?.path == "/v1/auth/refresh" }.count
                return earlier == 1 ? (200, try fixtures.data("session.signed-in")) : (401, try fixtures.data("error.unauthorized"))
            case (_, "Bearer stale"): return (401, try fixtures.data("error.unauthorized"))
            default: return (200, try fixtures.data("user.new"))
            }
        }

        async let first = client.me()
        async let second = client.me()
        async let third = client.me()
        _ = try await [first, second, third]

        XCTAssertEqual(StubProtocol.requests.filter { $0.url?.path == "/v1/auth/refresh" }.count, 1)
        let needsSignIn = await client.needsSignIn
        XCTAssertFalse(needsSignIn)
    }

    func testANetworkFailureWhileRenewingKeepsTheSession() async throws {
        let sessions = SessionVault(keychain: nil)
        let signedIn: Session = try fixtures.load("session.signed-in")
        await sessions.store(Session(accessToken: "stale", expiresIn: 3600, refreshToken: "rt_old", user: signedIn.user))
        let client = makeClient(sessions: sessions)
        StubProtocol.respond { request in
            request.url?.path == "/v1/auth/refresh" ? (503, Data()) : (401, try fixtures.data("error.unauthorized"))
        }

        _ = try? await client.me()

        let needsSignIn = await client.needsSignIn
        XCTAssertFalse(needsSignIn, "Only the API refusing the refresh token ends the session")
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

    func testPasskeyResponsesKeepTheirWebAuthnKeys() async throws {
        let client = makeClient()
        StubProtocol.respond { _ in (201, try fixtures.data("session.signed-in")) }
        let credential = Data(#"{"id":"abc","rawId":"abc","type":"public-key","response":{"clientDataJSON":"e30","attestationObject":"o2M"}}"#.utf8)

        _ = try await client.finishPasskey(.register, challengeId: "chl_1", credential: credential)

        let request = try XCTUnwrap(StubProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/v1/auth/passkeys/register/verify")
        let body = try XCTUnwrap(request.httpBodyStream.map(Data.init(reading:)) ?? request.httpBody)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(sent["challenge_id"] as? String, "chl_1")
        let sentCredential = try XCTUnwrap(sent["credential"] as? [String: Any])
        XCTAssertEqual(sentCredential["rawId"] as? String, "abc")
        XCTAssertNotNil((sentCredential["response"] as? [String: Any])?["clientDataJSON"])
        let needsSignIn = await client.needsSignIn
        XCTAssertFalse(needsSignIn)
    }

    func testClaimSendsTheDeviceKeyAndWaitsOutAPendingAccount() async throws {
        var client = makeClient()
        client.claimRetryDelay = .zero
        StubProtocol.respond { _ in
            StubProtocol.requests.count < 3
                ? (202, Data(#"{"status":"pending","near_account":"frank.fliq.testnet"}"#.utf8))
                : (201, try fixtures.data("user.new"))
        }

        _ = try await client.claimName(try XCTUnwrap(FliqName("frank")), publicKey: "ed25519:11111111111111111111111111111111")

        XCTAssertEqual(StubProtocol.requests.count, 3)
        let request = try XCTUnwrap(StubProtocol.requests.last)
        XCTAssertEqual(request.url?.path, "/v1/me/name")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "claim-frank")
        let body = try XCTUnwrap(request.httpBodyStream.map(Data.init(reading:)) ?? request.httpBody)
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(sent, ["name": "frank", "public_key": "ed25519:11111111111111111111111111111111"])
    }

    func testClaimGivesUpWhenTheAccountStaysPending() async throws {
        var client = makeClient()
        client.claimRetryDelay = .zero
        StubProtocol.respond { _ in (202, Data(#"{"status":"pending","near_account":"frank.fliq.testnet"}"#.utf8)) }

        do {
            _ = try await client.claimName(try XCTUnwrap(FliqName("frank")), publicKey: "ed25519:11111111111111111111111111111111")
            XCTFail("a claim that never finishes must not succeed")
        } catch {
            XCTAssertEqual(error as? APIError, .unexpected(status: 202))
        }
        XCTAssertEqual(StubProtocol.requests.count, HTTPClient.claimAttempts)
    }

    @MainActor
    func testAClaimTheChainCannotFinishIsNotCalledTaken() async throws {
        StubProtocol.respond { _ in
            (503, Data(#"{"error":{"code":"chain_unavailable","message":"Your NEAR account could not be created right now."}}"#.utf8))
        }
        let flow = try await claimingFlow()

        let claimed = await flow.claim()

        XCTAssertFalse(claimed)
        XCTAssertEqual(flow.status, .unreachable)
        XCTAssertEqual(flow.suggestions, [])
    }

    @MainActor
    func testANameTakenInTheMeantimeOffersOthers() async throws {
        StubProtocol.respond { _ in (409, Data(#"{"error":{"code":"conflict","message":"That name is taken."}}"#.utf8)) }
        let flow = try await claimingFlow()

        let claimed = await flow.claim()

        XCTAssertFalse(claimed)
        XCTAssertEqual(flow.status, .taken)
        XCTAssertFalse(flow.suggestions.isEmpty)
    }

    @MainActor
    func testTappingContinueAgainWhileClaimingSendsOneClaim() async throws {
        StubProtocol.respond { _ in (201, try fixtures.data("user.new")) }
        let flow = try await claimingFlow()

        async let first = flow.claim()
        async let second = flow.claim()
        let results = await [first, second]

        XCTAssertEqual(results.filter { $0 }.count, 1)
        XCTAssertEqual(StubProtocol.requests.filter { $0.url?.path == "/v1/me/name" }.count, 1)
        XCTAssertFalse(flow.isClaiming)
    }

    func testBase64URLRoundTrips() {
        let bytes = Data([0xfb, 0xff, 0x00, 0x10])
        XCTAssertEqual(bytes.base64URL, "-_8AEA")
        XCTAssertEqual(Data(base64URL: "-_8AEA"), bytes)
    }

    func testSignInLinksAreReadFromAnyForm() {
        XCTAssertEqual(SignInFlow.token(in: "https://fliq.cash/auth/verify?token=el_abc-123"), "el_abc-123")
        XCTAssertEqual(SignInFlow.token(in: "fliq://auth/verify?token=el_abc"), "el_abc")
        XCTAssertEqual(SignInFlow.token(in: "  el_abc\n"), "el_abc")
        XCTAssertNil(SignInFlow.token(in: "hello there"))
        XCTAssertNil(SignInFlow.token(in: "https://fliq.cash/auth/verify"))
    }

    @MainActor
    private func claimingFlow() async throws -> OnboardingFlow {
        var client = makeClient()
        client.claimRetryDelay = .zero
        let flow = OnboardingFlow(api: client, names: FixtureNameDirectory(), isLive: true, keys: FixedKeys())
        flow.nameText = "frank"
        // Wait out the debounced check that setting nameText starts, as the claim button does.
        while flow.status == .checking { try await Task.sleep(for: .milliseconds(50)) }
        XCTAssertEqual(flow.status, .available)
        return flow
    }

    func testAgentsAreReadFromTheAPI() async throws {
        let client = makeClient()
        StubProtocol.respond { request in
            request.url?.path == "/v1/agents" ? (200, try fixtures.data("agents.list")) : (404, Data())
        }

        let agents = try await makeAgentAPI(client).agents(vault: "fliq-vault.testnet")

        XCTAssertEqual(agents.map(\.id), ["claude-frank.fliq.near", "payroll-bot-frank.fliq.near"])
        XCTAssertEqual(agents[0].policy, AgentPolicy(dailyCap: 150_000, perPayout: 50_000, currencies: [.ngn], savedAccountsOnly: true))
        XCTAssertEqual(agents[0].usedToday, 30_000)
        XCTAssertEqual(agents[1].policy.currencies, [.kes])
    }

    func testAgentsShowWhatTheyPaidAndWereRefusedFromActivity() async throws {
        let client = makeClient()
        // Activity answers only when asked for what agents did, so the rows below also check the query.
        StubProtocol.respond { request in
            switch (request.url?.path, request.url?.query?.contains("filter=agents")) {
            case ("/v1/agents", _): (200, try fixtures.data("agents.list"))
            case ("/v1/activity", true): (200, try fixtures.data("activity.list"))
            default: (404, Data())
            }
        }

        let agents = try await makeAgentAPI(client).agents(vault: "fliq-vault.testnet")

        let claude = try XCTUnwrap(agents.first { $0.id == "claude-frank.fliq.near" })
        let refused = try XCTUnwrap(claude.events.first { $0.id == "act_ref_01jbd9a2c4e6g8j0k2m4p6r8s0" })
        XCTAssertEqual(refused.outcome, .refused(reason: "over the daily cap"))
        XCTAssertEqual(refused.amount, 500_000)
        XCTAssertEqual(refused.currency, .ngn)
        XCTAssertEqual(refused.recipient, "DARA OKONKWO")
        let paid = try XCTUnwrap(claude.events.first { $0.id == "act_po_5d18e2b7" })
        XCTAssertEqual(paid.outcome, .paid)
        XCTAssertEqual(paid.amount, 30_000)
        XCTAssertNotNil(paid.at)
    }

    func testUSDCSentToTheNameIsReadFromTheChainAndMovedIntoTheVault() async throws {
        let client = makeClient()
        let usdc = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"
        let relayed = Data(#"{"status":"succeeded","tx_hash":"tx","delegate_hash":"dh","sender_id":"frank.fliqaccount.testnet","receiver_id":"\#(usdc)"}"#.utf8)
        StubProtocol.respond { request in
            guard request.url?.host == "rpc.test" else {
                return request.url?.path == "/v1/relays" ? (200, relayed) : (404, Data())
            }
            let body = try JSONSerialization.jsonObject(with: Data(reading: request.httpBodyStream!)) as? [String: Any]
            let params = body?["params"] as? [String: String] ?? [:]
            let view = { (json: String) in Data(#"{"result":{"result":\#(Array(json.utf8))}}"#.utf8) }
            switch (body?["method"] as? String, params["method_name"]) {
            case ("block", _): return (200, Data(#"{"result":{"header":{"height":1000}}}"#.utf8))
            case (_, "get_config"): return (200, view(#"{"owner":"fliq-owner.testnet","approved_usdc_token_contract":"\#(usdc)"}"#))
            case (_, "ft_balance_of"): return (200, view(#""20000000""#))
            default: return (200, Data(#"{"result":{"nonce":41}}"#.utf8))
            }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        let rpc = NEARRPC(url: URL(string: "https://rpc.test")!, session: URLSession(configuration: configuration))
        let topUp = RelayedWalletTopUp(
            rpc: rpc,
            relay: DelegateRelay(api: client, rpc: rpc, keys: AgentKeys(), pollInterval: .zero),
            owner: { "frank.fliqaccount.testnet" },
            vault: { "fliq-vault.testnet" }
        )

        let waiting = try await topUp.waiting()
        _ = try await topUp.addToVault(waiting)

        XCTAssertEqual(waiting, TokenAmount(baseUnits: 20_000_000))
        let relay = try XCTUnwrap(StubProtocol.requests.first { $0.url?.path == "/v1/relays" })
        let sent = try JSONSerialization.jsonObject(with: Data(reading: relay.httpBodyStream!)) as? [String: String]
        let expected = DelegateAction.walletTopUp(
            from: "frank.fliqaccount.testnet", units: 20_000_000, usdc: usdc, vault: "fliq-vault.testnet",
            nonce: 42, blockHeight: 1000, publicKey: Data(count: 32)
        )
        XCTAssertEqual(sent?["signed_delegate"], expected.signed(with: AgentKeys.signature))
    }

    func testAgentsStillLoadWhenActivityFails() async throws {
        let client = makeClient()
        StubProtocol.respond { request in
            request.url?.path == "/v1/agents" ? (200, try fixtures.data("agents.list")) : (500, Data())
        }

        let agents = try await makeAgentAPI(client).agents(vault: "fliq-vault.testnet")

        XCTAssertEqual(agents.count, 2)
        XCTAssertTrue(agents.allSatisfy(\.events.isEmpty))
    }

    func testConnectingSignsTheSetAgentStepAndRelaysIt() async throws {
        let client = makeClient()
        let relayed = Data(#"{"status":"succeeded","tx_hash":"tx","delegate_hash":"dh","sender_id":"frank.fliqaccount.testnet","receiver_id":"fliq-vault.testnet"}"#.utf8)
        StubProtocol.respond { request in
            if request.url?.host == "rpc.test" {
                let body = try JSONSerialization.jsonObject(with: Data(reading: request.httpBodyStream!)) as? [String: Any]
                return body?["method"] as? String == "block"
                    ? (200, Data(#"{"result":{"header":{"height":1000}}}"#.utf8))
                    : (200, Data(#"{"result":{"nonce":41}}"#.utf8))
            }
            switch request.url?.path {
            case "/v1/agents": return (201, try fixtures.data("agent.connect"))
            case "/v1/relays": return (200, relayed)
            default: return (404, Data())
            }
        }

        let agent = try await makeAgentAPI(client).connect(
            name: "Claude", publicKey: "ed25519:5FjQ8mT3vXk2NcR7yLpW9sBdH4uZaE6gKoJt1qMi9kQ",
            policy: AgentPolicy(dailyCap: 150_000, perPayout: 50_000, currencies: [.ngn, .kes]), vault: "fliq-vault.testnet"
        )

        XCTAssertEqual(agent.id, "claude-frank.fliq.near")
        XCTAssertEqual(agent.status, .active)
        let connect = try XCTUnwrap(StubProtocol.requests.first { $0.url?.path == "/v1/agents" })
        XCTAssertNotNil(connect.value(forHTTPHeaderField: "Idempotency-Key"))
        let sent = try JSONSerialization.jsonObject(with: Data(reading: connect.httpBodyStream!)) as? [String: Any]
        XCTAssertEqual(sent?["currencies"] as? [String], ["KES", "NGN"])
        XCTAssertEqual((sent?["daily_cap"] as? [String: String])?["currency"], "NGN")

        let relay = try XCTUnwrap(StubProtocol.requests.first { $0.url?.path == "/v1/relays" })
        let body = try JSONSerialization.jsonObject(with: Data(reading: relay.httpBodyStream!)) as? [String: String]
        let step = try XCTUnwrap(SignStep.steps(in: fixtures.data("agent.connect")).first)
        let expected = DelegateAction.step(step, from: "frank.fliqaccount.testnet", nonce: 42, blockHeight: 1000, publicKey: Data(count: 32))
        XCTAssertEqual(body?["signed_delegate"], expected.signed(with: AgentKeys.signature))
    }

    func testSignStepsKeepTheirArgKeysAndTheFullStorageDeposit() throws {
        let step = try XCTUnwrap(SignStep.steps(in: fixtures.data("agent.connect")).first)
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: step.args) as? [String: Any])

        XCTAssertEqual(step.methodName, "set_agent")
        XCTAssertEqual(step.receiverId, "fliq-vault.testnet")
        XCTAssertEqual(step.gas, 30_000_000_000_000)
        XCTAssertEqual(Set(args.keys), ["public_key", "agent_id", "per_payout_cap", "daily_cap", "corridors", "cooldown_ns", "expiry_ns"])
        XCTAssertEqual(step.deposit, Yocto(decimal: "10000000000000000000000"))
        XCTAssertEqual(step.deposit.high, 542)
        XCTAssertEqual(step.deposit.low, 1_864_712_049_423_024_128)
    }

    func testYoctoRefusesWhatIsNotAU128() {
        XCTAssertEqual(Yocto(decimal: "1"), 1)
        XCTAssertEqual(Yocto(decimal: "340282366920938463463374607431768211455"), Yocto(low: .max, high: .max))
        XCTAssertNil(Yocto(decimal: "340282366920938463463374607431768211456"))
        XCTAssertNil(Yocto(decimal: "1.5"))
        XCTAssertNil(Yocto(decimal: ""))
    }

    func testCapsForAShillingOnlyAgentAreInShillings() {
        let limits = HTTPAgentAPI.Limits(AgentPolicy(dailyCap: 40_000, perPayout: 10_000, currencies: [.kes]))

        XCTAssertEqual(limits.dailyCap, HTTPAgentAPI.Cap(amount: "40000", currency: "KES"))
        XCTAssertEqual(limits.currencies, ["KES"])
    }

    private func makeAgentAPI(_ client: HTTPClient) -> HTTPAgentAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        let rpc = NEARRPC(url: URL(string: "https://rpc.test")!, session: URLSession(configuration: configuration))
        return HTTPAgentAPI(
            client: client,
            relay: DelegateRelay(api: client, rpc: rpc, keys: AgentKeys(), pollInterval: .zero),
            owner: { "frank.fliqaccount.testnet" }
        )
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

private struct AgentKeys: DeviceKeys {
    static let signature = Data(repeating: 7, count: 64)

    func publicKey() throws -> String { "ed25519:11111111111111111111111111111111" }
    func sign(_ message: Data, reason: String) throws -> Data { Self.signature }
}

private struct FixedKeys: DeviceKeys {
    func publicKey() throws -> String { "ed25519:11111111111111111111111111111111" }
}

private extension Data {
    init(reading stream: InputStream) {
        self.init()
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            append(buffer, count: count)
        }
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
