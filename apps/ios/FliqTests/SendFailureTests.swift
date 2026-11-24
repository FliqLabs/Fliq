import XCTest
@testable import Fliq

/// Sends that cannot be signed on this iPhone say why and point to the fix, and a cash-out leaves room for its fees.
@MainActor
final class SendFailureTests: XCTestCase {
    override func setUp() { RPCStub.reset() }
    override func tearDown() { RPCStub.reset() }

    private func rpc() -> NEARRPC {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RPCStub.self]
        return NEARRPC(url: URL(string: "https://rpc.test")!, session: URLSession(configuration: configuration))
    }

    // FastNEAR, mainnet: a missing key comes back as HTTP 200 with a result that carries the error.
    func testAMissingKeyOnFastNEARIsAnUnknownAccessKey() async {
        let key = "ed25519:11111111111111111111111111111111"
        RPCStub.respond { _ in
            (200, Data(#"{"jsonrpc":"2.0","result":{"block_hash":"5JhzbMoyqvAFVsRjMbYBLZLzbJuDdYWoLuyBMSJJJh7i","block_height":176382940,"error":"access key \#(key) does not exist while viewing","logs":[]},"id":"fliq"}"#.utf8))
        }
        do {
            _ = try await rpc().accessKeyNonce(account: "ada.fliq.near", publicKey: key)
            XCTFail("A missing key has no nonce")
        } catch let error as NEARRPCError {
            XCTAssertTrue(error.isUnknownAccessKey)
        } catch {
            XCTFail("Expected a NEARRPCError, got \(error)")
        }
    }

    func testAKeyOnTheAccountGivesItsNonce() async throws {
        RPCStub.respond { _ in (200, Data(#"{"result":{"nonce":41,"permission":"FullAccess","block_height":1,"block_hash":"h"}}"#.utf8)) }
        let nonce = try await rpc().accessKeyNonce(account: "ada.fliq.near", publicKey: "ed25519:11111111111111111111111111111111")
        XCTAssertEqual(nonce, 41)
    }

    func testAGatewayErrorIsThrownWithItsStatusAndRequestsTimeOutInTenSeconds() async {
        RPCStub.respond { _ in (502, Data("<html>Bad Gateway</html>".utf8)) }
        do {
            _ = try await rpc().finalBlockHeight()
            XCTFail("A 502 is not a block")
        } catch let error as NEARRPCError {
            XCTAssertEqual(error.status, 502)
        } catch {
            XCTFail("Expected a NEARRPCError, got \(error)")
        }
        XCTAssertEqual(RPCStub.requests.first?.timeoutInterval, 10)
    }

    func testAJSONRPCErrorKeepsItsCauseWhateverTheStatus() async throws {
        RPCStub.respond { _ in (400, Data(#"{"error":{"message":"no key","cause":{"name":"UNKNOWN_ACCESS_KEY"}}}"#.utf8)) }
        let found = try await rpc().hasAccessKey(account: "ada.fliq.near", publicKey: "ed25519:11111111111111111111111111111111")
        XCTAssertFalse(found)
    }

    // MARK: Not added

    private struct Failing: VaultTransfers {
        let error: Error
        func send(_ amount: TokenAmount, to recipient: String) async throws -> RelayResult? { throw error }
        func release(_ payout: Payout) async throws -> RelayResult? { throw error }
    }

    private func personFlow(_ error: Error, recovery: (any AccountRecovering)? = nil) async -> PersonPayFlow {
        let flow = PersonPayFlow(
            api: FixtureClient(), transfers: Failing(error: error), vault: VaultStore(balance: TokenAmount(baseUnits: 100_000_000)),
            account: "tobi" + FliqName.suffix, recovery: recovery
        )
        await flow.lookUp()
        flow.enterAmount("5")
        return flow
    }

    func testAnUnknownKeyOffersTheRestoreSheet() async {
        let flow = await personFlow(NEARRPCError(message: "gone", cause: NEARRPCError.unknownAccessKey), recovery: FixtureAccountRecovery(.notBackedUp))

        let paid = await flow.pay()

        XCTAssertFalse(paid)
        XCTAssertEqual(flow.errorMessage, SignFailure.notAddedMessage)
        XCTAssertEqual(flow.signing.restoreState, .cannotSign)
        XCTAssertFalse(flow.canPay)
    }

    func testAMissingPrivateKeyOpensTheBackupRestoreWhenThereIsOne() async {
        let flow = await personFlow(KeychainError(status: errSecItemNotFound), recovery: FixtureAccountRecovery(.canRestore))

        _ = await flow.pay()

        XCTAssertEqual(flow.errorMessage, SignFailure.notAddedMessage)
        XCTAssertEqual(flow.signing.restoreState, .canRestore)
    }

    func testOpeningAMoneyScreenChecksTheChainAgain() async {
        let recovery = FixtureAccountRecovery(.cannotSign)
        let flow = await personFlow(TransferError.stillPending, recovery: recovery)

        await flow.signing.check()
        XCTAssertEqual(flow.signing.restoreState, .cannotSign)
        XCTAssertFalse(flow.canPay)

        try? await recovery.restore(with: PasskeyKeyStub())
        await flow.signing.check()
        XCTAssertNil(flow.signing.restoreState)
        XCTAssertTrue(flow.canPay)
    }

    func testAnUnreadableChainIsAskedOnceMore() async {
        let recovery = FlakyRecovery(answers: [nil, .canRestore])
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), vault: VaultStore(balance: TokenAmount(baseUnits: 10_000_000)), recovery: recovery)
        flow.enterAmount("5")

        await flow.signing.check()

        let asked = await recovery.asked
        XCTAssertEqual(asked, 2)
        XCTAssertEqual(flow.signing.restoreState, .canRestore)
        XCTAssertFalse(flow.hasAmount)
    }

    func testAnUnreadableChainTwiceGuessesNothing() async {
        let flow = WithdrawFlow(withdrawals: FixtureWithdrawals(), recovery: FlakyRecovery(answers: [nil, nil]))
        await flow.signing.check()
        XCTAssertNil(flow.signing.restoreState)
    }

    func testAWithdrawFromAnIPhoneNotAddedOffersTheRestoreSheet() async {
        let flow = WithdrawFlow(withdrawals: SignFails(), vault: VaultStore(balance: TokenAmount(baseUnits: 10_000_000)), recovery: FixtureAccountRecovery(.notBackedUp))
        flow.enterAmount("5")
        flow.pick("bob.near")
        await flow.checkAddress()

        let sent = await flow.send()

        XCTAssertFalse(sent)
        XCTAssertEqual(flow.errorMessage, SignFailure.notAddedMessage)
        XCTAssertEqual(flow.signing.restoreState, .cannotSign)
    }

    // MARK: Keychain

    func testKeychainErrorsAreSaidPlainly() {
        XCTAssertEqual(SignFailure(KeychainError(status: errSecItemNotFound), passcodeSet: { true }), .notAdded)
        XCTAssertEqual(SignFailure(KeychainError(status: errSecAuthFailed), passcodeSet: { false }), .noPasscode)
        XCTAssertEqual(SignFailure.noPasscode.message, "Turn on a passcode in Settings to send.")
        XCTAssertNil(SignFailure(KeychainError(status: errSecAuthFailed), passcodeSet: { true }), "With a passcode set it was a failed Face ID")
        XCTAssertNil(SignFailure(KeychainError(status: errSecUserCanceled), passcodeSet: { false }), "Cancelling is not an error")
        XCTAssertEqual(SignFailure(TransferError.notSetUp), .signInAgain)
    }

    // MARK: Cash-out

    private func cashOut(balance: Int64, amount: String, transfers: any VaultTransfers = FixtureVaultTransfers()) async -> PayFlow {
        let flow = PayFlow(api: FixtureClient(), vault: VaultStore(balance: TokenAmount(baseUnits: balance)), transfers: transfers)
        flow.enterAmount(amount)
        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        return flow
    }

    func testACashOutWithNoAccountToSignForSaysSignInAgain() async {
        let transfers = RelayedVaultTransfers(
            api: FixtureClient(), rpc: rpc(), keys: PasskeyKeyStub(), sender: { nil }, vault: { "fliq-vault.near" }
        )
        let flow = await cashOut(balance: 100_000_000, amount: "50", transfers: transfers)
        _ = await flow.fetchQuote()

        let started = await flow.send()

        XCTAssertFalse(started, "Nothing was signed, so nothing started")
        XCTAssertNil(flow.payout)
        XCTAssertEqual(flow.errorMessage, "Sign in again to send.")
    }

    func testACashOutOfTheWholeVaultIsStoppedByItsFees() async {
        // The fixture quote's fees are ₦344 at ₦1,383.20 to the dollar: $0.25.
        let flow = await cashOut(balance: 50_000_000, amount: "50")

        let quoted = await flow.fetchQuote()

        XCTAssertFalse(quoted)
        XCTAssertEqual(flow.fees, TokenAmount(baseUnits: 250_000))
        XCTAssertTrue(flow.isOverBalanceWithFees)
        XCTAssertEqual(flow.errorMessage, "With fees, the most you can cash out is $49.75.")
        let sent = await flow.send()
        XCTAssertFalse(sent)
    }

    func testACashOutWithRoomForItsFeesGoesAhead() async {
        let flow = await cashOut(balance: 50_250_000, amount: "50")
        let quoted = await flow.fetchQuote()
        XCTAssertTrue(quoted)
        XCTAssertNil(flow.errorMessage)
    }

    func testMaxFillsTheVaultLessTwoCentsInDollars() async {
        let flow = await cashOut(balance: 50_000_000, amount: "")
        await flow.loadRate()
        flow.switchUnit()

        flow.useMax()

        XCTAssertEqual(flow.unit, .dollars)
        XCTAssertEqual(flow.amountText, "49.98")
        XCTAssertEqual(flow.amount, TokenAmount(baseUnits: 49_980_000))
    }
}

private struct PasskeyKeyStub: DeviceKeys {
    func publicKey() throws -> String { "ed25519:11111111111111111111111111111111" }
}

/// Signing fails as it does on an iPhone whose private key is not in the Keychain.
private struct SignFails: Withdrawals {
    func check(_ address: String) async -> AddressCheck { .ready(needsSetup: false) }
    func prepare(_ amount: TokenAmount, to address: String) async throws -> PreparedWithdraw {
        PreparedWithdraw(amount: amount, address: address, actions: [])
    }
    func sign(_ prepared: PreparedWithdraw) throws -> SignedWithdraw { throw KeychainError(status: errSecItemNotFound) }
    func deliver(_ signed: SignedWithdraw) async throws -> WithdrawReceipt { WithdrawReceipt(transactionHash: "") }
}

private actor FlakyRecovery: AccountRecovering {
    private var answers: [RecoveryState?]
    private(set) var asked = 0

    init(answers: [RecoveryState?]) { self.answers = answers }

    func state() async -> RecoveryState? {
        asked += 1
        return answers.isEmpty ? nil : answers.removeFirst()
    }
    func backUp() async throws {}
    func restore() async throws {}
    func restore(with passkey: any DeviceKeys) async throws {}
    func addThisIPhone(to account: String, with passkey: any DeviceKeys) async throws {}
    func keys() async -> [AccountKey]? { nil }
    func remove(_ key: AccountKey) async throws {}
}

private final class RPCStub: URLProtocol, @unchecked Sendable {
    typealias Responder = @Sendable (URLRequest) -> (Int, Data)

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
        let (status, data) = respond(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
