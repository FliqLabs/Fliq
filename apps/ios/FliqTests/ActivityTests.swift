import XCTest
@testable import Fliq

@MainActor
final class ActivityTests: XCTestCase {
    private func pay(_ amount: String, api: FixtureClient, activity: ActivityStore) async -> PayFlow {
        let flow = PayFlow(api: api, activity: activity)
        flow.enterAmount(amount)
        _ = await flow.fetchQuote()
        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        _ = await flow.send()
        return flow
    }

    func testEachPayoutGetsItsOwnRowAndIsUpdatedInPlace() async {
        let api = FixtureClient()
        let activity = ActivityStore()

        let first = await pay("50", api: api, activity: activity)
        await first.track()
        let second = await pay("20", api: api, activity: activity)

        XCTAssertEqual(activity.entries.count, 2)
        XCTAssertNotEqual(activity.entries[0].id, activity.entries[1].id)
        XCTAssertEqual(activity.entries[0].id, second.payout?.payoutId, "Newest first")
        XCTAssertEqual(activity.entries[1].payout.state, .settled, "Tracking updates the same row")
    }

    func testThirteenDollarsIsRefundedInTheDemo() async throws {
        let flow = await pay("13", api: FixtureClient(), activity: ActivityStore())
        await flow.track()
        let payout = try XCTUnwrap(flow.payout)

        XCTAssertEqual(payout.state, .refunded)
        XCTAssertNil(payout.bankReference, "A refunded payout never shows a bank reference")
        XCTAssertEqual(payout.history.map(\.state), [.awaitingDeposit, .depositSeen, .payingOut, .refunded])
    }

    func testSameIdempotencyKeyReturnsTheSamePayout() async throws {
        let api = FixtureClient()
        let request = PayoutRequest(quoteId: "q_31ad77e0", account: Account(bank: "058", number: "0123456789"))

        let once = try await api.createPayout(request, idempotencyKey: "key-1")
        let again = try await api.createPayout(request, idempotencyKey: "key-1")
        let other = try await api.createPayout(request, idempotencyKey: "key-2")

        XCTAssertEqual(once.payoutId, again.payoutId)
        XCTAssertNotEqual(once.payoutId, other.payoutId)
    }

    func testRoutesLandWhatTheDesignShows() throws {
        let quote: Quote = try FixtureClient().load("quote.usdc-ngn-50")
        let busha = try XCTUnwrap(quote.routes.first { $0.provider == .busha }?.rate)
        let fonbnk = try XCTUnwrap(quote.routes.first { $0.provider == .fonbnk }?.rate)

        XCTAssertEqual(Money.estimate(quote.amount, at: busha), 68504)
        XCTAssertEqual(Money.estimate(quote.amount, at: fonbnk), 67920)
        XCTAssertEqual(quote.receive - Money.estimate(quote.amount, at: busha), 312)
    }
}
