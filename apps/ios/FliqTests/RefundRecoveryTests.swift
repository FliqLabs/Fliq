import XCTest
@testable import Fliq

/// A deposit that 1Click refunded sits in the user's NEAR Intents balance. The app must show it and bring it back.
@MainActor
final class RefundRecoveryTests: XCTestCase {
    func testTheMoveIsAnIntentsTransferOfTheWholeRefundToTheRouteAddress() throws {
        let route = ReturnedRefund(
            depositId: "dep_back", depositAddress: String(repeating: "ab", count: 32), tokenId: Refund.sample.tokenId,
            units: "1632606", lands: "1.632446", intentsContract: "intents.near"
        )
        let action = DelegateAction.intentsReturn(from: "faiz.fliqaccount.near", refund: route, nonce: 7, blockHeight: 100, publicKey: Data(count: 32))
        XCTAssertEqual(action.receiverId, "intents.near")
        XCTAssertEqual(action.call.methodName, "mt_transfer")
        XCTAssertEqual(action.call.deposit, 1, "Intents moves only for a full-access key, which the yoctoNEAR proves")
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: action.call.args) as? [String: String])
        XCTAssertEqual(args, ["receiver_id": route.depositAddress, "token_id": route.tokenId, "amount": "1632606"])
    }

    func testHomeShowsARefundAndClearsItOnceBroughtBack() async {
        let topUp = CountingTopUp()
        let inbox = WalletInbox(topUp: topUp)
        await inbox.load()
        XCTAssertEqual(Money.dollars(inbox.refundTotal), "1.63")
        await inbox.bringBackRefunds()
        XCTAssertEqual(topUp.broughtBack, [Refund.sample.tokenId])
        XCTAssertTrue(inbox.refunds.isEmpty)
        XCTAssertTrue(inbox.refundOnItsWay)
    }

    func testARefundDecodesFromTheAPIShape() throws {
        let json = #"{"items":[{"token_id":"nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near","symbol":"usdc","chain":"solana","units":"1632606","amount":"1.632606","intents_contract":"intents.near"}]}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        XCTAssertEqual(try decoder.decode(RefundList.self, from: Data(json.utf8)).items, [Refund.sample])
    }
}

private final class CountingTopUp: WalletTopUp, @unchecked Sendable {
    private(set) var broughtBack: [String] = []
    func waiting() async throws -> TokenAmount { .zero }
    func addToVault(_ amount: TokenAmount) async throws -> RelayResult? { nil }
    func refunds() async throws -> [Refund] { broughtBack.isEmpty ? [.sample] : [] }
    func bringBack(_ refund: Refund) async throws -> RelayResult? {
        broughtBack.append(refund.tokenId)
        return nil
    }
}
