import XCTest
@testable import Fliq

/// A cash-out from the vault moves only when the payer signs the vault's payout for the registered order.
@MainActor
final class CashOutReleaseTests: XCTestCase {
    private actor Recording: VaultTransfers {
        var released: [Payout] = []
        var refusal: String?

        init(refusal: String? = nil) { self.refusal = refusal }

        nonisolated func send(_ amount: TokenAmount, to recipient: String) async throws -> RelayResult? { nil }

        func release(_ payout: Payout) async throws -> RelayResult? {
            if let refusal { throw TransferError.refused(refusal) }
            released.append(payout)
            return nil
        }
    }

    private func readyFlow(_ transfers: Recording) async throws -> PayFlow {
        let flow = PayFlow(api: FixtureClient(), vault: VaultStore(balance: TokenAmount(baseUnits: 100_000_000)), transfers: transfers)
        flow.enterAmount("50")
        _ = await flow.fetchQuote()
        flow.recipient.number = "0123456789"
        await flow.recipient.verify()
        return flow
    }

    func testSendingSignsThePayoutForTheOrderTheAPIRegistered() async throws {
        let transfers = Recording()
        let flow = try await readyFlow(transfers)

        let started = await flow.send()

        XCTAssertTrue(started)
        let released = await transfers.released
        XCTAssertEqual(released.map(\.payoutId), [flow.payout?.payoutId].compactMap { $0 })
    }

    func testAVaultRefusalSaysNothingMovedAndKeepsTheBalance() async throws {
        let transfers = Recording(refusal: "amount differs from the order")
        let flow = try await readyFlow(transfers)

        let started = await flow.send()

        XCTAssertFalse(started)
        XCTAssertEqual(flow.errorMessage, "The vault refused it: amount differs from the order. Nothing moved.")
    }

    func testThePayoutCallNamesTheOrderItsAmountAndAddressWithEnoughGas() throws {
        let action = DelegateAction.vaultPayout(
            from: "olien.fliqaccount.near", orderId: "po_01m75zg16kvty0rtwx8kz9eeg3", units: 10_070_359,
            depositAddress: "3b1b31c12912c31aaabef865f280ca705537ba3dc6fac8e9862e1f2b2a519c3c", vault: "fliq-vault.near",
            nonce: 7, blockHeight: 100, publicKey: Data(repeating: 1, count: 32)
        )
        XCTAssertEqual(action.receiverId, "fliq-vault.near")
        XCTAssertEqual(action.call.methodName, "payout")
        XCTAssertEqual(action.call.deposit, 0)
        XCTAssertGreaterThanOrEqual(action.call.gas, 60_000_000_000_000)
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: action.call.args) as? [String: String])
        XCTAssertEqual(args, ["order_id": "po_01m75zg16kvty0rtwx8kz9eeg3", "amount": "10070359", "deposit_address": "3b1b31c12912c31aaabef865f280ca705537ba3dc6fac8e9862e1f2b2a519c3c"])
    }
}
