import XCTest
@testable import Fliq

@MainActor
final class PayFlowTests: XCTestCase {
    private func makeFlow() -> PayFlow { PayFlow(api: FixtureClient()) }

    func testKeypadBuildsAValidAmount() {
        let flow = makeFlow()
        for key in ["0", "5", "0", ".", "0", "0", "9", "⌫"] { flow.tapKey(key) }

        XCTAssertEqual(flow.amountText, "50.0", "The 9 is refused as a third decimal, then one 0 is deleted")
        XCTAssertEqual(flow.amount?.baseUnits, 50_000_000)
    }

    func testKeypadRejectsASecondDotAndAThirdDecimal() {
        let flow = makeFlow()
        for key in [".", "5", ".", "2", "5", "7"] { flow.tapKey(key) }

        XCTAssertEqual(flow.amountText, "0.52")
    }

    func testAccountIsVerifiedOnlyWhenComplete() async {
        let flow = makeFlow()
        flow.recipient.number = "012345678"
        await flow.recipient.verify()
        XCTAssertNil(flow.verified)

        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        XCTAssertEqual(flow.verified?.accountName, "DARA OKONKWO")

        flow.recipient.number = "0123456780"
        XCTAssertNil(flow.verified, "Editing the number must drop the old confirmation")
    }

    func testQuoteShowsTheServerReceiveAndTheRouteAdvantage() async throws {
        let flow = makeFlow()
        for key in ["5", "0"] { flow.tapKey(key) }

        let quoted = await flow.fetchQuote()
        let quote = try XCTUnwrap(flow.quote)

        XCTAssertTrue(quoted)
        XCTAssertEqual(quote.receive, 68816)
        XCTAssertEqual(Money.fee(quote.fees.total, quote.currency), "₦344")
        XCTAssertEqual(Money.routeAdvantage(quote), 312)
        XCTAssertEqual(flow.secondsLeft(at: .now), 90)
    }

    func testEstimateNeverPromisesMoreThanTheRate() throws {
        let fifty = try XCTUnwrap(TokenAmount(decimalString: "50"))
        XCTAssertEqual(Money.estimate(fifty, at: 1376.32), 68816)
        XCTAssertEqual(Money.estimate(try XCTUnwrap(TokenAmount(decimalString: "0.01")), at: 1376.32), 13)
    }

    func testSendNeedsAVerifiedAccountThenTracksToSettled() async {
        let flow = makeFlow()
        flow.tapKey("5")
        _ = await flow.fetchQuote()
        let sentWithoutAccount = await flow.send()
        XCTAssertFalse(sentWithoutAccount)

        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        let sent = await flow.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(flow.payout?.state, .awaitingDeposit)

        await flow.track()
        XCTAssertEqual(flow.payout?.state, .settled)
        XCTAssertNotNil(flow.payout?.bankReference)
    }
}
