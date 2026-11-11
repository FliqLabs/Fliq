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
}
