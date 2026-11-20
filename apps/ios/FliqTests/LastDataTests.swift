import XCTest
@testable import Fliq

/// What fliq shows at launch, before the network answers: the last balance and history, never a false $0.
@MainActor
final class LastDataTests: XCTestCase {
    private func freshDefaults(_ name: String = #function) -> UserDefaults {
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    private func balance(_ dollars: String) -> VaultBalance {
        let amount = TokenAmount(decimalString: dollars)!
        return VaultBalance(account: "ada.fliqaccount.near", available: amount, reserved: .zero, total: amount, inSync: true)
    }

    func testTheLastBalanceIsThereAtLaunch() {
        let cache = freshDefaults()
        let first = VaultStore(cache: cache)
        XCTAssertFalse(first.isKnown, "Nothing kept and nothing read: a placeholder, not $0")
        first.sync(balance("77.26"))

        let relaunched = VaultStore(cache: cache)
        XCTAssertTrue(relaunched.isKnown)
        XCTAssertEqual(relaunched.balance, TokenAmount(decimalString: "77.26"))
    }

    func testMoneyMovedHereIsKeptToo() {
        let cache = freshDefaults()
        let store = VaultStore(cache: cache)
        store.sync(balance("10"))
        store.debit(TokenAmount(decimalString: "4")!)
        XCTAssertEqual(VaultStore(cache: cache).balance, TokenAmount(decimalString: "6"))
    }

    func testSigningOutForgetsTheBalanceAndHistory() async {
        let cache = freshDefaults()
        let vault = VaultStore(cache: cache)
        vault.sync(balance("10"))
        vault.forget()
        XCTAssertFalse(VaultStore(cache: cache).isKnown)

        let activity = ActivityStore(defaults: nil, cache: cache)
        await activity.load(from: FixtureClient())
        activity.forget()
        XCTAssertFalse(activity.hasLoaded)
        XCTAssertTrue(ActivityStore(defaults: nil, cache: cache).history.isEmpty)
    }

    func testTheLastHistoryIsThereAtLaunch() async {
        let cache = freshDefaults()
        let first = ActivityStore(defaults: nil, cache: cache)
        XCTAssertFalse(first.hasLoaded, "Placeholder rows, not Nothing yet")
        await first.load(from: FixtureClient())
        XCTAssertFalse(first.history.isEmpty)

        let relaunched = ActivityStore(defaults: nil, cache: cache)
        XCTAssertTrue(relaunched.hasLoaded)
        XCTAssertEqual(relaunched.history, first.history)
    }

    func testBuildsWithoutACacheBehaveAsBefore() {
        XCTAssertTrue(VaultStore().isKnown)
        XCTAssertTrue(ActivityStore(defaults: nil).hasLoaded)
    }
}
