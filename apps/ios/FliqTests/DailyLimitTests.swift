import XCTest
@testable import Fliq

@MainActor
final class DailyLimitTests: XCTestCase {
    private struct Approves: Biometrics {
        let answer: Bool
        func approve(_ reason: String) async -> Bool { answer }
    }

    private final class Clock: @unchecked Sendable {
        var now = Date(timeIntervalSince1970: 1_800_000_000)
    }

    private func dollars(_ text: String) -> TokenAmount { TokenAmount(decimalString: text)! }

    private func makeModel(limit: String? = nil, spent: String = "0", approves: Bool = true, clock: Clock = Clock()) -> DailyLimitModel {
        let api = FixtureLimitsAPI(limit: limit.map(dollars), spent: dollars(spent), now: { clock.now })
        return DailyLimitModel(api: api, biometrics: Approves(answer: approves))
    }

    func testANewAccountHasNoLimit() async {
        let model = makeModel()
        await model.load()
        XCTAssertEqual(model.limits, Limits.none)
    }

    func testAFirstLimitAndALowerLimitApplyAtOnce() async {
        let model = makeModel()
        await model.load()
        model.enterAmount("500")
        let saved = await model.save()
        XCTAssertTrue(saved)
        XCTAssertEqual(model.limits?.limitAmount, dollars("500"))
        XCTAssertNil(model.limits?.pending)

        model.startEditing()
        model.enterAmount("200")
        XCTAssertFalse(model.typedIsRaise)
        _ = await model.save()
        XCTAssertEqual(model.limits?.limitAmount, dollars("200"))
        XCTAssertNil(model.limits?.pending)
    }

    func testARaiseWaitsADayAndTheOldLimitStaysUntilThen() async {
        let clock = Clock()
        let model = makeModel(limit: "100", spent: "30", clock: clock)
        await model.load()
        XCTAssertEqual(model.limits?.remainingAmount, dollars("70"))

        model.enterAmount("2000")
        XCTAssertTrue(model.typedIsRaise)
        _ = await model.save()
        XCTAssertEqual(model.limits?.limitAmount, dollars("100"))
        XCTAssertEqual(model.limits?.pending?.dailyLimit, "2000.00")
        XCTAssertEqual(model.limits?.pending?.effectiveAt, clock.now.addingTimeInterval(24 * 60 * 60))

        clock.now.addTimeInterval(24 * 60 * 60)
        await model.load()
        XCTAssertEqual(model.limits?.limitAmount, dollars("2000"))
        XCTAssertNil(model.limits?.pending)
    }

    func testRemovingWaitsTooAndCanBeCancelled() async {
        let model = makeModel(limit: "100")
        await model.load()
        _ = await model.remove()
        XCTAssertEqual(model.limits?.limitAmount, dollars("100"))
        XCTAssertNotNil(model.limits?.pending)
        XCTAssertNil(model.limits?.pending?.dailyLimit)
        XCTAssertEqual(DailyLimitView.pendingTitle(model.limits!.pending!), "Your limit is being removed")

        _ = await model.cancelPending()
        XCTAssertNil(model.limits?.pending)
        XCTAssertEqual(model.limits?.limitAmount, dollars("100"))
    }

    func testNothingChangesWithoutFaceID() async {
        let model = makeModel(limit: "100", approves: false)
        await model.load()
        model.enterAmount("5")
        let saved = await model.save()
        XCTAssertFalse(saved)
        XCTAssertEqual(model.limits?.limitAmount, dollars("100"))
    }

    func testTheSameLimitCannotBeSavedAgain() async {
        let model = makeModel(limit: "100")
        await model.load()
        model.enterAmount("100")
        XCTAssertFalse(model.canSave)
        model.enterAmount("101")
        XCTAssertTrue(model.canSave)
    }

    func testLimitsDecodeFromTheAPIShape() throws {
        let json = #"{"daily_limit":"500.00","spent_today":"120.00","remaining":"380.00","pending":{"daily_limit":null,"effective_at":"2026-11-15T10:00:00.000Z"}}"#
        let limits = try FliqJSON.decoder().decode(Limits.self, from: Data(json.utf8))
        XCTAssertEqual(limits.limitAmount, dollars("500"))
        XCTAssertEqual(limits.usedFraction, 0.24, accuracy: 0.001)
        XCTAssertNotNil(limits.pending)
        XCTAssertNil(limits.pending?.dailyLimit)
        XCTAssertEqual(DailyLimitView.pendingTitle(Limits.Pending(dailyLimit: "2000.00", effectiveAt: .now)), "Going up to $2,000")
    }
}
