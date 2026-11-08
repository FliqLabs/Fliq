import XCTest
@testable import Fliq

@MainActor
final class PayFlowTests: XCTestCase {
    private func makeFlow() -> PayFlow { PayFlow(api: FixtureClient()) }

    func testTypedAmountBecomesAValidAmount() {
        let flow = makeFlow()
        XCTAssertEqual(flow.enterAmount("50.0"), "50.0")
        XCTAssertEqual(flow.amount?.baseUnits, 50_000_000)
    }

    func testAmountTypingKeepsOneSeparatorAndTwoDecimals() {
        XCTAssertEqual(AmountTyping.clean("0.52", previous: ""), "0.52")
        XCTAssertEqual(AmountTyping.clean("0.527", previous: "0.52"), "0.52", "A third decimal is refused")
        XCTAssertEqual(AmountTyping.clean("5.2.", previous: "5.2"), "5.2", "A second separator is refused")
        XCTAssertEqual(AmountTyping.clean(".", previous: ""), "0.")
    }

    func testAmountTypingDropsLeadingZeros() {
        XCTAssertEqual(AmountTyping.clean("05", previous: "0"), "5")
        XCTAssertEqual(AmountTyping.clean("00", previous: "0"), "0")
        XCTAssertEqual(AmountTyping.clean("0", previous: ""), "0")
        XCTAssertEqual(AmountTyping.clean("00.5", previous: "0.5"), "0.5")
    }

    func testAmountTypingAcceptsACommaAndIgnoresOtherCharacters() {
        XCTAssertEqual(AmountTyping.clean("12,5", previous: "12"), "12.5")
        XCTAssertEqual(AmountTyping.clean("$1 2a", previous: ""), "12")
        XCTAssertEqual(AmountTyping.clean("", previous: "5"), "")
    }

    func testAmountTypingCapsTheLength() {
        XCTAssertEqual(AmountTyping.clean("123456789", previous: "12345678"), "123456789")
        XCTAssertEqual(AmountTyping.clean("1234567890", previous: "123456789"), "123456789")
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
        flow.enterAmount("50")

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
        flow.enterAmount("5")
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
