import XCTest
@testable import Fliq

@MainActor
final class BankDepositTests: XCTestCase {
    private func flow(_ paj: FixturePaj = FixturePaj()) -> BankDepositFlow {
        let flow = BankDepositFlow(paj: paj, signIn: paj, sessions: nil) {
            BankDepositDestination(address: "BX7M5C8ssXWreX9NpiG414qYVbfMoet9zTrzgNfFMc9M", isTestWallet: true)
        }
        flow.pollInterval = .milliseconds(1)
        return flow
    }

    func testNairaIsTypedInWholeAmounts() {
        let flow = flow()
        XCTAssertEqual(flow.enterAmount("0050.5"), "505")
        flow.pick(20_000)
        XCTAssertEqual(flow.naira, 20_000)
    }

    func testOnlyAnEmailOrAnInternationalPhoneCanSignIn() {
        XCTAssertTrue(BankDepositFlow.isContact("gift@entrypointlabs.xyz"))
        XCTAssertTrue(BankDepositFlow.isContact("+2348012345678"))
        XCTAssertFalse(BankDepositFlow.isContact("08012345678"))
        XCTAssertFalse(BankDepositFlow.isContact("gift@"))
    }

    func testTheFirstDepositSignsInOnceThenShowsTheBankDetails() async throws {
        let flow = flow()
        await flow.load()
        XCTAssertEqual(flow.rate, 1397.72)
        XCTAssertEqual(try XCTUnwrap(flow.usdcEstimate), 5000 / 1397.72, accuracy: 0.0001)

        await flow.getBankDetails()
        XCTAssertEqual(flow.step, .signIn)

        flow.contact = "gift@entrypointlabs.xyz"
        await flow.sendCode()
        XCTAssertTrue(flow.codeSent)
        flow.code = "2350"
        await flow.verify()

        XCTAssertTrue(flow.isSignedIn)
        XCTAssertEqual(flow.step, .pay)
        XCTAssertEqual(flow.order?.naira, 5000)
        XCTAssertEqual(flow.destination?.isTestWallet, true)
    }

    func testSentMoneyIsFollowedUntilItLands() async {
        let flow = flow()
        await flow.getBankDetails()
        flow.contact = "+2348012345678"
        await flow.sendCode()
        flow.code = "1234"
        await flow.verify()

        await flow.watch()
        XCTAssertEqual(flow.step, .done)
        XCTAssertEqual(flow.order?.status, .completed)
    }

    func testCancellingWarnsNotToPayAndStartsFresh() async {
        let flow = flow()
        flow.contact = "+2348012345678"
        await flow.getBankDetails()
        await flow.sendCode()
        flow.code = "1234"
        await flow.verify()

        flow.cancel()
        XCTAssertEqual(flow.step, .cancelled)
        flow.startOver()
        XCTAssertEqual(flow.step, .amount)
        XCTAssertNil(flow.order)
        XCTAssertNotNil(flow.notice)
    }

    func testRoundingNeverPromisesMoreThanArrives() {
        XCTAssertEqual(NairaFormat.dollars(3.578975), "$3.57")
        XCTAssertEqual(NairaFormat.full(5000), "₦5,000.00")
        XCTAssertEqual(NairaFormat.rate(1397.72), "₦1,397.72")
    }

    func testPajErrorMessagesReachTheScreen() {
        XCTAssertEqual(PajMessage.from(Data(#"{"message":["Phone or email is required."]}"#.utf8)), "Phone or email is required.")
        XCTAssertEqual(PajMessage.from(Data(#"{"error":"paj_not_configured"}"#.utf8)), "Bank deposits aren't switched on yet.")
        XCTAssertEqual(WebPajSignIn.contactField("+2348012345678")["phone"] as? String, "+2348012345678")
    }
    // MARK: - The minimum

    private static let solana = DepositSource(tokenId: "usdc", chainId: "solana", group: .dollars)

    /// A flow whose money goes through a deposit address, at ₦1,000 to the dollar before Paj's fee and ₦2,000 after it.
    private func gated(deposits: StubDeposits = StubDeposits()) -> BankDepositFlow {
        let paj = FeePaj()
        let flow = BankDepositFlow(paj: paj, signIn: paj, sessions: nil, deposits: deposits, route: Self.solana) {
            BankDepositDestination(address: "made-up-address", deposit: StubDeposits.address)
        }
        flow.pollInterval = .milliseconds(1)
        return flow
    }

    private func signIn(_ flow: BankDepositFlow) async {
        await flow.getBankDetails()
        flow.contact = "ada@example.com"
        await flow.sendCode()
        flow.code = "1234"
        await flow.verify()
    }

    func testNothingCanContinueUntilTheRateIsKnown() {
        let flow = gated()
        XCTAssertFalse(flow.canContinue)
        XCTAssertNil(flow.minimumNote, "No number is shown that the rate cannot back")
    }

    func testWithoutAQuoteTheEstimateMustClearTheMinimumByAMargin() async {
        let flow = gated()
        await flow.load()

        flow.enterAmount("1400")
        XCTAssertFalse(flow.canContinue, "$1.40 before fees may land under $1")
        XCTAssertEqual(flow.minimumNote, "The smallest amount is about ₦1,500.")

        flow.enterAmount("1500")
        XCTAssertTrue(flow.canContinue)
        XCTAssertNil(flow.minimumNote)

        flow.enterAmount("5000")
        XCTAssertTrue(flow.canContinue)
    }

    func testWithAQuoteWhatPajDeliversDecides() async {
        let flow = gated()
        await flow.load()
        await signIn(flow)
        flow.startOver()

        flow.enterAmount("1999")
        await flow.refreshQuote()
        XCTAssertFalse(flow.canContinue, "Just under $1 after Paj's fee")
        XCTAssertEqual(flow.minimumNote, "This amount is too small to arrive after fees. Try a larger one.")

        flow.enterAmount("2000")
        await flow.refreshQuote()
        XCTAssertTrue(flow.canContinue, "Exactly the minimum lands")
        XCTAssertNil(flow.minimumNote)

        flow.enterAmount("3000")
        await flow.refreshQuote()
        XCTAssertTrue(flow.canContinue)
    }

    func testTheMinimumComesFromTheAPIsSources() async {
        let flow = gated(deposits: StubDeposits(minimum: TokenAmount(baseUnits: 2_000_000)))
        XCTAssertEqual(flow.minimum, BankDepositFlow.fallbackMinimum)

        await flow.load()

        XCTAssertEqual(flow.minimum, TokenAmount(baseUnits: 2_000_000))
        flow.enterAmount("2900")
        XCTAssertFalse(flow.canContinue)
        XCTAssertEqual(flow.minimumNote, "The smallest amount is about ₦3,000.")
    }

    func testBankDetailsAreNotShownForAnOrderThatCannotArrive() async {
        let flow = gated()
        await flow.load()
        flow.enterAmount("1600")
        XCTAssertTrue(flow.canContinue, "The estimate clears the margin before Paj has quoted")

        await signIn(flow)

        XCTAssertEqual(flow.step, .amount)
        XCTAssertNil(flow.order)
        XCTAssertFalse(flow.canContinue)
        XCTAssertNotNil(flow.minimumNote)
    }

    func testATestWalletTakesAnyAmount() async {
        let flow = flow()
        await flow.load()
        flow.enterAmount("100")
        XCTAssertNil(flow.minimum)
        XCTAssertTrue(flow.canContinue)
    }

    // MARK: - Money that is not coming

    func testAnUnderpaidOrRefundedDepositReadsAsNotReceived() async {
        for stage in [DepositStatus.Stage.underpaid, .refunded, .expired, .failed] {
            let flow = gated(deposits: StubDeposits(stage: stage))
            await flow.load()
            await signIn(flow)

            await flow.watch()

            XCTAssertEqual(flow.step, .notReceived, "\(stage)")
        }
    }

    func testADepositThatLandsIsDone() async {
        let flow = gated(deposits: StubDeposits(stage: .landed))
        await flow.load()
        await signIn(flow)

        await flow.watch()

        XCTAssertEqual(flow.step, .done)
        XCTAssertFalse(flow.isStillMoving)
    }

    func testAWaitThatRunsOutDoesNotClaimTheMoneyLanded() async {
        let flow = gated(deposits: StubDeposits(stage: .bridging))
        await flow.load()
        await signIn(flow)

        await flow.watch()

        XCTAssertEqual(flow.step, .done)
        XCTAssertTrue(flow.isStillMoving)
    }
}

/// Paj at ₦1,000 to the dollar, keeping half as its fee, with an order that is complete the first time it is read.
private struct FeePaj: PajAPI, PajSignIn {
    func publicRate() async throws -> Double { 1000 }

    func quote(naira: Int, session: Paj.Session) async throws -> Paj.Quote {
        Paj.Quote(naira: naira, usdc: Double(naira) / 2000, rate: 1000)
    }

    func createOrder(naira: Int, recipient: String, session: Paj.Session) async throws -> Paj.Order {
        order(naira: naira, status: .initiated)
    }

    func order(_ id: String, session: Paj.Session) async throws -> Paj.Order {
        order(naira: 5000, status: .completed)
    }

    private func order(naira: Int, status: Paj.Order.Status) -> Paj.Order {
        Paj.Order(
            id: "made-up-order", naira: naira, usdc: Double(naira) / 2000, rate: 1000,
            accountNumber: "0000000000", accountName: "Made-up account", bank: "Made-up bank", status: status
        )
    }

    func sendCode(to contact: String) async throws {}

    func verify(_ contact: String, code: String) async throws -> Paj.Session {
        Paj.Session(token: "made-up", expiresAt: .now.addingTimeInterval(86_400), contact: contact)
    }
}

private struct StubDeposits: DepositAPI {
    static let address = DepositAddress(
        source: DepositSource(tokenId: "usdc", chainId: "solana", group: .dollars), depositId: "dep_made_up", address: "made-up-address",
        minimum: TokenAmount(baseUnits: 1_000_000), fee: .zero, reservedUntil: .distantFuture, estimatedSeconds: 35, isDemo: false
    )

    var minimum = TokenAmount(baseUnits: 1_000_000)
    var stage = DepositStatus.Stage.landed

    func sources() async throws -> [DepositSource] {
        [DepositSource(tokenId: "usdc", chainId: "solana", group: .dollars, minimum: minimum)]
    }

    func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress { Self.address }

    func status(of deposit: DepositAddress) async throws -> DepositStatus {
        DepositStatus(stage: stage, received: nil, seenAt: nil, bridgingAt: nil, landedAt: nil)
    }
}
