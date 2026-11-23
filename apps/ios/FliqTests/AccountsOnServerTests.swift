import XCTest
@testable import Fliq

/// Saved bank accounts live on the server, so deleting the app loses none of them.
@MainActor
final class AccountsOnServerTests: XCTestCase {
    private let dara = VerifiedAccount(bank: "058", number: "0123456789", accountName: "DARA OKONKWO", institution: "GTBank", country: .ng)
    private let emeka = VerifiedAccount(bank: "999992", number: "8012343301", accountName: "EMEKA STUDIOS LTD", institution: "OPay", country: .ng)

    func testAccountsKeptOnlyOnThisIPhoneAreUploadedAndComeBackAfterAReinstall() async {
        let api = FixtureClient()
        let before = AccountBook(keychain: nil)
        before.setOwn(dara)
        before.save(emeka)
        before.connect(api)
        await before.sync()
        let onServer = await api.savedRecipients.list()
        XCTAssertEqual(onServer.count, 2, "Both uploaded")
        XCTAssertEqual(onServer.first { $0.own == true }?.accountLast4, "6789", "Yours stays yours")

        // Deleted and installed again: nothing on the iPhone.
        let after = AccountBook(keychain: nil)
        after.connect(api)
        await after.sync()
        XCTAssertEqual(after.own?.number, "••••6789")
        XCTAssertEqual(after.own?.recipientId, onServer.first { $0.own == true }?.recipientId)
        XCTAssertEqual(after.saved.map(\.number), ["••••3301"])
    }

    func testARestoredAccountIsPaidByItsIdAndAKnownOneByItsNumber() {
        let restored = VerifiedAccount(bank: "058", number: "••••6789", accountName: "DARA OKONKWO", institution: "GTBank", recipientId: "rcp_1")
        XCTAssertEqual(PayoutRequest(quoteId: "q", to: restored), PayoutRequest(quoteId: "q", recipientId: "rcp_1"))
        var known = dara
        known.recipientId = "rcp_1"
        XCTAssertEqual(PayoutRequest(quoteId: "q", to: known), PayoutRequest(quoteId: "q", account: Account(bank: "058", number: "0123456789")))
    }

    func testThePayoutBodyCarriesOnlyOneOfThem() throws {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let byId = String(decoding: try encoder.encode(PayoutRequest(quoteId: "q", recipientId: "rcp_1")), as: UTF8.self)
        XCTAssertTrue(byId.contains("\"recipient_id\":\"rcp_1\""))
        XCTAssertFalse(byId.contains("account"))
    }

    func testSavingTheSameAccountTwiceKeepsOne() async {
        let api = FixtureClient()
        let book = AccountBook(keychain: nil)
        book.connect(api)
        book.save(emeka)
        book.save(emeka)
        XCTAssertEqual(book.saved.count, 1)
    }
}
