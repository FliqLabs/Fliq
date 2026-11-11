import XCTest
@testable import Fliq

/// Paying another fliq user from the vault, and starting a payout from the Pay to sheet.
@MainActor
final class PersonPayTests: XCTestCase {
    private struct Refusing: VaultTransfers {
        let reason: String
        func send(_ amount: TokenAmount, to recipient: String) async throws -> RelayResult? { throw TransferError.refused(reason) }
        func release(_ payout: Payout) async throws -> RelayResult? { throw TransferError.refused(reason) }
    }

    private func flow(transfers: any VaultTransfers = FixtureVaultTransfers(), balance: Int64 = 100_000_000) -> PersonPayFlow {
        PersonPayFlow(api: FixtureClient(), transfers: transfers, vault: VaultStore(balance: TokenAmount(baseUnits: balance)), account: "tobi" + FliqName.suffix)
    }

    func testAPaidUserLeavesTheVaultAtOnce() async {
        let flow = flow()
        await flow.lookUp()
        XCTAssertEqual(flow.person?.displayName, "Tobi A.")
        flow.enterAmount("25")

        let paid = await flow.pay()

        XCTAssertTrue(paid)
        XCTAssertEqual(flow.paid, TokenAmount(baseUnits: 25_000_000))
        XCTAssertEqual(flow.available, TokenAmount(baseUnits: 75_000_000))
    }

    func testMoreThanTheVaultHoldsCannotBePaid() async {
        let flow = flow(balance: 10_000_000)
        await flow.lookUp()
        flow.enterAmount("25")

        XCTAssertFalse(flow.canPay)
    }

    func testAVaultRefusalSaysWhyAndMovesNothing() async {
        let flow = flow(transfers: Refusing(reason: "Smart contract panicked: INSUFFICIENT_BALANCE"))
        await flow.lookUp()
        flow.enterAmount("5")

        let paid = await flow.pay()

        XCTAssertFalse(paid)
        XCTAssertEqual(flow.errorMessage, "Your vault doesn't have enough for this.")
        XCTAssertEqual(flow.available, TokenAmount(baseUnits: 100_000_000))
    }

    func testTheNameStartsWithoutItsSuffix() {
        XCTAssertEqual(flow().nameText, "tobi")
    }

    func testASavedAccountSkipsStraightToTheAmount() {
        let dara = VerifiedAccount(bank: "058", number: "0123456789", accountName: "DARA OKONKWO", institution: "GTBank", country: .ng)
        let pay = PayFlow(api: FixtureClient())

        pay.recipient.use(dara)

        XCTAssertEqual(pay.verified, dara)
        XCTAssertEqual(pay.currency, .ngn)
    }

    func testAKenyanAccountIsPaidInShillings() {
        let wanjiru = VerifiedAccount(bank: "mpesa", number: "0712345412", accountName: "WANJIRU K.", institution: "M-Pesa", country: .ke)
        let pay = PayFlow(api: FixtureClient())

        pay.recipient.use(wanjiru)

        XCTAssertEqual(pay.currency, .kes)
    }
}
