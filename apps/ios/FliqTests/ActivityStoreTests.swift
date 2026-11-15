import XCTest
@testable import Fliq

@MainActor
final class ActivityStoreTests: XCTestCase {
    private let fixtures = FixtureClient()

    func testHistoryLoadsNewestFirstWithEveryKind() async throws {
        let store = ActivityStore()
        await store.load(from: fixtures)

        XCTAssertFalse(store.history.isEmpty)
        XCTAssertEqual(store.rows.map(\.date), store.rows.map(\.date).sorted(by: >))
        XCTAssertTrue(store.history.contains { $0.kind == .deposit })
        XCTAssertTrue(store.history.contains { $0.kind == .refused && $0.agent != nil })
    }

    func testAPayoutStartedHereGivesWayOnceTheServerListsIt() async throws {
        let store = ActivityStore()
        let payout: Payout = try fixtures.load("payout.created")
        store.record(payout)
        XCTAssertEqual(store.rows.first, .local(store.entries[0]))

        await store.load(from: fixtures)

        let listed = store.history.contains { $0.refId == payout.payoutId }
        let localRows = store.rows.filter { if case .local = $0 { true } else { false } }
        XCTAssertEqual(localRows.isEmpty, listed)
        XCTAssertEqual(store.entry(id: payout.payoutId)?.payout, payout, "The receipt still opens from the live entry")
    }

    func testAgentRowsAreTold() async {
        let store = ActivityStore()
        await store.load(from: fixtures)
        XCTAssertEqual(store.rows.filter(\.isAgent).count, store.history.filter { $0.agent != nil }.count)
    }
}

@MainActor
final class BankDepositActivityTests: XCTestCase {
    private func store() -> ActivityStore {
        ActivityStore(defaults: UserDefaults(suiteName: "bank-activity-\(UUID().uuidString)"))
    }

    private func listed(_ status: String, refId: String) -> ActivityItem {
        ActivityItem(
            activityId: "act_\(refId)", kind: .deposit, status: status, at: .now,
            party: .init(name: "Received from Solana", nearAccount: nil, institution: nil, accountLast4: nil, photoUrl: nil),
            provider: nil, agent: nil, local: nil, usd: "3.40", token: "3.41 USDC", seconds: 75, reason: nil, refId: refId
        )
    }

    func testABankDepositShowsAsArrivingTheMomentItIsPaid() {
        let activity = store()
        activity.recordBankDeposit(.init(depositId: "dep_1", naira: 5_000, usd: "3.41", startedAt: .now))
        let line = activity.lines.first
        XCTAssertEqual(line?.title, "From your bank")
        XCTAssertEqual(line?.outcome, .moving)
        XCTAssertEqual(line?.statusText, "Arriving")
        XCTAssertEqual(line.map(HomeInProgressCard.headline), "$3.41 on its way to your vault")
    }

    func testOnceListedItKeepsTheBankLabelAndTheServerStatus() {
        let activity = store()
        activity.recordBankDeposit(.init(depositId: "dep_1", naira: 5_000, usd: "3.41", startedAt: .now))
        activity.setHistoryForTesting([listed("received", refId: "dep_1")])
        XCTAssertEqual(activity.lines.count, 1, "Shown once, not twice")
        XCTAssertEqual(activity.lines.first?.title, "From your bank")
        XCTAssertEqual(activity.lines.first?.outcome, .done)
        XCTAssertEqual(activity.lines.first?.amount, "+$3.40")
    }

    func testItIsRememberedAcrossLaunches() {
        let defaults = UserDefaults(suiteName: "bank-activity-\(UUID().uuidString)")
        ActivityStore(defaults: defaults).recordBankDeposit(.init(depositId: "dep_9", naira: 2_500, usd: "1.70", startedAt: .now))
        XCTAssertEqual(ActivityStore(defaults: defaults).lines.first?.title, "From your bank")
    }

    func testAnOldOneTheServerNeverListedIsDropped() {
        let activity = store()
        activity.recordBankDeposit(.init(depositId: "dep_old", naira: 5_000, usd: "3.41", startedAt: .now.addingTimeInterval(-4 * 3600)))
        XCTAssertTrue(activity.lines.isEmpty)
    }
}
