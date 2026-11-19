import XCTest
@testable import Fliq

@MainActor
final class HomeCurrencyTests: XCTestCase {
    private func freshDefaults(_ name: String = #function) -> UserDefaults {
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    func testDollarsUntilTheOwnerPicksACurrency() {
        let defaults = freshDefaults()
        XCTAssertEqual(DisplayCurrency.stored(in: defaults), .usd)
        defaults.set(DisplayCurrency.ngn.rawValue, forKey: DisplayCurrency.storageKey)
        XCTAssertEqual(DisplayCurrency.stored(in: defaults), .ngn)
        XCTAssertEqual(DisplayCurrency.ngn.symbol, "₦")
        XCTAssertNil(DisplayCurrency.usd.local)
    }

    func testTheBalanceInNairaIsWhatTheVaultWouldPayOut() async {
        let defaults = freshDefaults()
        let model = HomeModel(api: FixtureClient(), vault: VaultStore(balance: TokenAmount(baseUnits: 50_000_000)), defaults: defaults)
        XCTAssertNil(model.balance(in: .ngn), "No rate yet, so Home keeps showing dollars")
        await model.load()
        XCTAssertEqual(model.balance(in: .ngn), 68816, "Rounded down at the live rate, never more than a payout gives")
        XCTAssertEqual(Money.grouped(68816), "68,816")
    }

    func testARateForTheWrongCurrencyIsNotKept() async {
        // The fixture answers every currency with the naira rate.
        let model = HomeModel(api: FixtureClient(), defaults: freshDefaults())
        await model.load()
        XCTAssertNil(model.rate(for: .kes))
        XCTAssertNotNil(model.rate(for: .ngn))
    }

    func testTheLastRateShowsOnLaunchBeforeTheNetworkAnswers() async {
        let defaults = freshDefaults()
        let vault = VaultStore(balance: TokenAmount(baseUnits: 50_000_000))
        await HomeModel(api: FixtureClient(), vault: vault, defaults: defaults).load()

        let relaunched = HomeModel(api: FixtureClient(), vault: vault, defaults: defaults)
        XCTAssertEqual(relaunched.balance(in: .ngn), 68816)
    }
}
