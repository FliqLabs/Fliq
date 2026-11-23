import XCTest
@testable import Fliq

/// Notification choices and the rate alert live on the server, which is what sends them.
@MainActor
final class NotificationSettingsTests: XCTestCase {
    private func freshDefaults(_ name: String = #function) throws -> UserDefaults {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    func testChoicesMadeBeforeTheFirstSyncGoUp() async throws {
        let api = FixtureClient()
        let prefs = Preferences(defaults: try freshDefaults())
        prefs.set(.payoutPaid, false)
        prefs.set(.weeklySummary, true)
        prefs.connect(api)
        await prefs.sync()
        let saved = await api.savedNotifications.settings
        XCTAssertFalse(saved.payoutPaid)
        XCTAssertTrue(saved.weeklySummary)
    }

    func testAfterAReinstallTheServersChoicesComeBack() async throws {
        let api = FixtureClient()
        await api.savedNotifications.preset(.init(
            received: true, payoutPaid: false, payoutRefunded: true, agentPaid: true, agentRefused: true, capAlmostReached: true,
            rateAlert: .init(enabled: true, currency: "NGN", above: 1_480), weeklySummary: true
        ))
        let prefs = Preferences(defaults: try freshDefaults())
        prefs.connect(api)
        await prefs.sync()
        XCTAssertFalse(prefs.isOn(.payoutPaid))
        XCTAssertTrue(prefs.isOn(.rateAlert))
        XCTAssertEqual(prefs.rateDetail, "When $1 beats ₦1,480")
        let saved = await api.savedNotifications.settings
        XCTAssertFalse(saved.payoutPaid, "The fresh install did not overwrite them")
    }

    func testTheRateGoesToTheServerAndTheAlertOnlyCountsOnceItHasOne() async throws {
        let api = FixtureClient()
        let prefs = Preferences(defaults: try freshDefaults())
        prefs.connect(api)
        prefs.set(.rateAlert, true)
        await prefs.uploaded()
        var saved = await api.savedNotifications.settings
        XCTAssertFalse(saved.rateAlert.enabled, "The server refuses an alert with no rate")

        prefs.setRate(above: 1_460, in: .ngn)
        await prefs.uploaded()
        saved = await api.savedNotifications.settings
        XCTAssertEqual(saved.rateAlert, .init(enabled: true, currency: "NGN", above: 1_460))
    }

    func testQuickChangesReachTheServerInOrder() async throws {
        let api = FixtureClient()
        let prefs = Preferences(defaults: try freshDefaults())
        prefs.connect(api)
        prefs.set(.weeklySummary, true)
        prefs.set(.weeklySummary, false)
        prefs.set(.weeklySummary, true)
        await prefs.uploaded()
        let saved = await api.savedNotifications.settings
        XCTAssertTrue(saved.weeklySummary)
        let saves = await api.savedNotifications.saves
        XCTAssertEqual(saves, 3)
    }

    func testTheRateAndCurrencySurviveRelaunch() throws {
        let defaults = try freshDefaults()
        Preferences(defaults: defaults).setRate(above: 140, in: .kes)
        let relaunched = Preferences(defaults: defaults)
        XCTAssertEqual(relaunched.rateDetail, "When $1 beats KSh140")
    }

    func testTheBodyAlwaysCarriesTheRateKey() throws {
        let body = String(decoding: try FliqJSON.encoder().encode(Preferences.newUser), as: UTF8.self)
        XCTAssertTrue(body.contains("\"above\":null"))
        XCTAssertTrue(body.contains("\"payout_paid\":true"))
        XCTAssertTrue(body.contains("\"cap_almost_reached\":true"))
    }

    func testAChangeMadeOfflineIsSentAtTheNextSyncNotUndone() async throws {
        let api = FixtureClient()
        let defaults = try freshDefaults()
        let prefs = Preferences(defaults: defaults)
        prefs.connect(api)
        await prefs.sync()
        await api.savedNotifications.setOffline(true)
        prefs.set(.payoutPaid, false)
        await prefs.uploaded()

        await api.savedNotifications.setOffline(false)
        let relaunched = Preferences(defaults: defaults)
        relaunched.connect(api)
        await relaunched.sync()
        XCTAssertFalse(relaunched.isOn(.payoutPaid), "The server's older copy did not win")
        let saved = await api.savedNotifications.settings
        XCTAssertFalse(saved.payoutPaid)
    }

    func testACoinWithMoreThanSixDecimalsStillShowsWhatArrived() {
        XCTAssertNil(TokenAmount(decimalString: "0.137662345"))
        XCTAssertEqual(TokenAmount(roundingDown: "0.137662345")?.decimalString, "0.137662")
        XCTAssertEqual(TokenAmount(roundingDown: "0.041000000000000001")?.decimalString, "0.041")
    }

    func testTheSuggestedRateIsTheNextRoundTenAboveToday() {
        XCTAssertEqual(RateSuggestion.above(1_452.3), 1_460)
        XCTAssertEqual(RateSuggestion.above(1_450), 1_460)
        XCTAssertEqual(RateSuggestion.above(129.2), 130)
    }
}
