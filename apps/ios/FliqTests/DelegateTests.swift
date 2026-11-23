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

    /// `encodeDelegateAction` from near-api-js for `addFullAccessKey` and `deleteKey` of the key with bytes 101...132,
    /// on ada.fliqaccount.near, nonce 7, max block height 1000, signed by the key with bytes 1...32.
    private let addKeyMessage = "6e010040140000006164612e666c69716163636f756e742e6e656172140000006164612e666c69716163636f756e742e6e65617201000000050065666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80818283840000000000000000010700000000000000e803000000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
    private let deleteKeyMessage = "6e010040140000006164612e666c69716163636f756e742e6e656172140000006164612e666c69716163636f756e742e6e65617201000000060065666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80818283840700000000000000e803000000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

    private func keyDelegate(_ change: KeyDelegate.Change) -> KeyDelegate {
        KeyDelegate(account: "ada.fliqaccount.near", change: change, nonce: 7, maxBlockHeight: 1000, publicKey: Data((1...32).map(UInt8.init)))
    }

    private func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

    func testAddingAndRemovingAKeyIsEncodedExactlyAsNearAPIJSEncodesIt() {
        let other = Data((101...132).map(UInt8.init))
        let prefix = "6e010040"
        XCTAssertEqual(prefix + hex(keyDelegate(.add(other)).borsh), addKeyMessage)
        XCTAssertEqual(prefix + hex(keyDelegate(.remove(other)).borsh), deleteKeyMessage)
    }

    func testAKeyChangeIsSignedOverTheSamePrefixedMessage() throws {
        let action = keyDelegate(.add(Data((101...132).map(UInt8.init))))
        let message = Data(stride(from: 0, to: addKeyMessage.count, by: 2).map { offset -> UInt8 in
            let start = addKeyMessage.index(addKeyMessage.startIndex, offsetBy: offset)
            return UInt8(addKeyMessage[start..<addKeyMessage.index(start, offsetBy: 2)], radix: 16)!
        })
        XCTAssertEqual(action.signingHash, Data(SHA256.hash(data: message)))
        let signed = try XCTUnwrap(Data(base64Encoded: action.signed(with: try key.signature(for: action.signingHash))))
        XCTAssertEqual(signed.count, action.borsh.count + 65)
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
