import CryptoKit
import XCTest
@testable import Fliq

final class WalletTopUpTests: XCTestCase {
    /// near-api-js 7.4.0 `buildDelegateAction` and `encodeSignedDelegate` for the same call, signed by the key with seed bytes 1...32.
    private let nearAPIJS = "GQAAAGZyYW5rLmZsaXFhY2NvdW50LnRlc3RuZXRAAAAAM2UyMjEwZTExODRiNDViNjRjOGE0MzRjMGE3ZTdiMjNjYzA0ZWE3ZWI3YTZjM2MzMjUyMGQwM2Q0YWZjYjhhZgEAAAACEAAAAGZ0X3RyYW5zZmVyX2NhbGxBAAAAeyJyZWNlaXZlcl9pZCI6ImZsaXEtdmF1bHQudGVzdG5ldCIsImFtb3VudCI6IjIwMDAwMDAwIiwibXNnIjoiIn0AQHoQ81oAAAEAAAAAAAAAAAAAAAAAAAAqAAAAAAAAAOwTAAAAAAAAAHm1Vi6P5lT5QHixEuipi6eQH4U65pW+1+DjkQutBJZkAAJch3rmOj8y3cKF6KEvPVcHz/Rj6selVZ9ViKP8+HBEeyYXm5dO2bVFzc86AqAP3uGWOx+NUMVJaSYp6p6mKwk="

    private let key = try! Curve25519.Signing.PrivateKey(rawRepresentation: Data((1...32).map(UInt8.init)))

    private var topUp: DelegateAction {
        .walletTopUp(
            from: "frank.fliqaccount.testnet",
            units: 20_000_000,
            usdc: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
            vault: "fliq-vault.testnet",
            nonce: 42,
            blockHeight: 5_100 - DelegateAction.lifetimeBlocks,
            publicKey: key.publicKey.rawRepresentation
        )
    }

    func testTheTopUpIsEncodedExactlyAsNearAPIJSEncodesIt() throws {
        let reference = try XCTUnwrap(Data(base64Encoded: nearAPIJS))
        XCTAssertEqual(topUp.borsh, reference.dropLast(65))
        XCTAssertTrue(key.publicKey.isValidSignature(reference.suffix(64), for: topUp.signingHash))
    }

    func testTheTopUpAttachesOneYoctoAndStaysUnderTheRelayerGasCap() {
        XCTAssertEqual(topUp.call.deposit, 1)
        XCTAssertEqual(topUp.call.gas, 100_000_000_000_000)
    }

    @MainActor
    func testNothingWaitingShowsNoCard() async {
        let inbox = WalletInbox(topUp: FixtureWalletTopUp())

        await inbox.load()

        XCTAssertEqual(inbox.waiting, .zero)
    }

    @MainActor
    func testAddingMovesEverythingWaitingAndRefreshesTheVault() async {
        let inbox = WalletInbox(topUp: FixtureWalletTopUp(amount: TokenAmount(baseUnits: 20_000_000)))
        var refreshed = false
        inbox.onAdded = { refreshed = true }

        await inbox.load()
        XCTAssertEqual(inbox.waiting, TokenAmount(baseUnits: 20_000_000))
        await inbox.add()

        XCTAssertEqual(inbox.waiting, .zero)
        XCTAssertTrue(refreshed)
        XCTAssertNil(inbox.errorMessage)
    }

    @MainActor
    func testAnAccountWithoutNEARGetsAPlainMessage() async {
        let inbox = WalletInbox(topUp: FailingTopUp(error: TransferError.refused(#"{"ActionError":{"kind":{"LackBalanceForState":{}}}}"#)))

        await inbox.load()
        await inbox.add()

        XCTAssertEqual(inbox.errorMessage, WalletInbox.needsNEAR)
        XCTAssertEqual(inbox.waiting, TokenAmount(baseUnits: 5_000_000))
        XCTAssertFalse(inbox.isAdding)
    }

    @MainActor
    func testAnyOtherFailureSaysTryAgain() async {
        let inbox = WalletInbox(topUp: FailingTopUp(error: TransferError.stillPending))

        await inbox.load()
        await inbox.add()

        XCTAssertEqual(inbox.errorMessage, WalletInbox.failed)
    }
}

private struct FailingTopUp: WalletTopUp, @unchecked Sendable {
    let error: Error

    func waiting() async throws -> TokenAmount { TokenAmount(baseUnits: 5_000_000) }
    func addToVault(_ amount: TokenAmount) async throws -> RelayResult? { throw error }
}
