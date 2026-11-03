import XCTest
@testable import Fliq

@MainActor
final class SettingsTests: XCTestCase {
    private let dara = VerifiedAccount(bank: "058", number: "0123456789", accountName: "DARA OKONKWO", institution: "GTBank")

    func testSavedAccountsSkipDuplicatesAndYourOwn() {
        let book = AccountBook(keychain: nil)
        book.save(dara)
        book.save(dara)
        XCTAssertEqual(book.saved.count, 1)

        book.setOwn(dara)
        let fresh = AccountBook(keychain: nil)
        fresh.setOwn(dara)
        fresh.save(dara)
        XCTAssertTrue(fresh.saved.isEmpty, "Your own account is not listed again under Saved")

        book.remove(dara)
        XCTAssertTrue(book.saved.isEmpty)
    }

    func testPayingWithSaveOnKeepsTheRecipient() async {
        let book = AccountBook(keychain: nil)
        let flow = PayFlow(api: FixtureClient(), accounts: book)
        flow.tapKey("5")
        _ = await flow.fetchQuote()
        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        _ = await flow.send()

        XCTAssertEqual(book.saved.first?.accountName, "DARA OKONKWO")
    }

    func testPayingWithSaveOffKeepsNothing() async {
        let book = AccountBook(keychain: nil)
        let flow = PayFlow(api: FixtureClient(), accounts: book)
        flow.saveAccount = false
        flow.tapKey("5")
        _ = await flow.fetchQuote()
        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        _ = await flow.send()

        XCTAssertTrue(book.saved.isEmpty)
    }

    func testNotificationChoicesSurviveRelaunch() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: #function))
        defaults.removePersistentDomain(forName: #function)

        let prefs = Preferences(defaults: defaults)
        XCTAssertTrue(prefs.isOn(.payoutPaid))
        XCTAssertFalse(prefs.isOn(.weeklySummary))

        prefs.set(.payoutPaid, false)
        prefs.set(.weeklySummary, true)
        let relaunched = Preferences(defaults: defaults)
        XCTAssertFalse(relaunched.isOn(.payoutPaid))
        XCTAssertTrue(relaunched.isOn(.weeklySummary))
    }

    func testKeychainRoundTrip() throws {
        let keychain = Keychain(service: "cash.fliq.tests.\(UUID().uuidString)")
        do {
            try keychain.save(dara, for: "own")
        } catch let error as KeychainError where error.status == errSecMissingEntitlement {
            throw XCTSkip("Unsigned test build has no Keychain entitlement (CODE_SIGNING_ALLOWED=NO)")
        }
        XCTAssertEqual(keychain.load(VerifiedAccount.self, for: "own"), dara)
        keychain.delete("own")
        XCTAssertNil(keychain.load(VerifiedAccount.self, for: "own"))
    }
}
