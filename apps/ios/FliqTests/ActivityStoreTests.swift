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
