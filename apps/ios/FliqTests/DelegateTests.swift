import CryptoKit
import XCTest
@testable import Fliq

/// The signed delegate the phone sends to `POST /relays`, checked against near-api-js 7.4.0 for the same key and call.
final class DelegateTests: XCTestCase {
    /// `buildDelegateAction` and `encodeSignedDelegate` from near-api-js, signed by the key with seed bytes 1...32.
    private let nearAPIJS = "GQAAAGZyYW5rLmZsaXFhY2NvdW50LnRlc3RuZXQSAAAAZmxpcS12YXVsdC50ZXN0bmV0AQAAAAIIAAAAdHJhbnNmZXI9AAAAeyJ0b19hY2NvdW50IjoidG9iaS5mbGlxYWNjb3VudC50ZXN0bmV0IiwiYW1vdW50IjoiMjUwMDAwMDAifQDgV+tIGwAAAQAAAAAAAAAAAAAAAAAAACoAAAAAAAAA7BMAAAAAAAAAebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQAm1lt8+6PEeP2edzxGEZE/eXXtRiWRH6P/cVBi1VM+dKBHc18kF7T/y5tyVm9WgM1WtOTxk6itV1GXiXYia/8Bg=="

    private let key = try! Curve25519.Signing.PrivateKey(rawRepresentation: Data((1...32).map(UInt8.init)))

    private var transfer: DelegateAction {
        .vaultTransfer(
            from: "frank.fliqaccount.testnet",
            to: "tobi.fliqaccount.testnet",
            units: 25_000_000,
            vault: "fliq-vault.testnet",
            nonce: 42,
            blockHeight: 5_100 - DelegateAction.lifetimeBlocks,
            publicKey: key.publicKey.rawRepresentation
        )
    }

    func testTheActionIsEncodedExactlyAsNearAPIJSEncodesIt() throws {
        let reference = try XCTUnwrap(Data(base64Encoded: nearAPIJS))
        XCTAssertEqual(transfer.borsh, reference.dropLast(65))
    }

    func testNearAPIJSsSignatureVerifiesOverOurSigningHash() throws {
        let reference = try XCTUnwrap(Data(base64Encoded: nearAPIJS))
        let signature = reference.suffix(64)
        XCTAssertTrue(key.publicKey.isValidSignature(signature, for: transfer.signingHash))
    }

    func testOurSignedDelegateHasTheSameLayout() throws {
        let signature = try key.signature(for: transfer.signingHash)
        let signed = try XCTUnwrap(Data(base64Encoded: transfer.signed(with: signature)))
        let reference = try XCTUnwrap(Data(base64Encoded: nearAPIJS))
        XCTAssertEqual(signed.count, reference.count)
        XCTAssertEqual(signed.dropLast(64), reference.dropLast(64))
        XCTAssertTrue(key.publicKey.isValidSignature(signed.suffix(64), for: transfer.signingHash))
    }
}
