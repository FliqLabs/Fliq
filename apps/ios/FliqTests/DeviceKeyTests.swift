import CryptoKit
import XCTest
@testable import Fliq

/// The NEAR key the phone makes for the user's account, and how it is written for NEAR.
final class DeviceKeyTests: XCTestCase {
    func testBase58MatchesTheBitcoinAlphabet() {
        XCTAssertEqual(NEARKey.base58(Data("Hello World!".utf8)), "2NEpo7TZRRrLZSi2U")
        XCTAssertEqual(NEARKey.base58(Data([0, 0, 1])), "112")
        XCTAssertEqual(NEARKey.base58(Data(count: 32)), String(repeating: "1", count: 32))
    }

    func testPublicKeysAreWrittenTheWayNEARReadsThem() {
        let key = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation
        let encoded = NEARKey.encode(key)
        XCTAssertNotNil(encoded.range(of: "^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$", options: .regularExpression), encoded)
    }

    func testAWrittenKeyReadsBackToItsBytes() {
        let key = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation
        XCTAssertEqual(NEARKey.decode(NEARKey.encode(key)), key)
        XCTAssertEqual(NEARKey.decode("ed25519:9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj")?.count, 32)
        XCTAssertNil(NEARKey.decode("secp256k1:abc"))
    }

    func testTheDeviceKeyIsMadeOnceAndKept() throws {
        let keys = KeychainDeviceKeys(service: "cash.fliq.near-key.tests.\(UUID().uuidString)")
        let first: String
        do {
            first = try keys.publicKey()
        } catch let error as KeychainError where error.status == errSecMissingEntitlement {
            throw XCTSkip("Unsigned test build has no Keychain entitlement (CODE_SIGNING_ALLOWED=NO)")
        }
        XCTAssertEqual(try keys.publicKey(), first)
        XCTAssertTrue(first.hasPrefix("ed25519:"))
    }
}

@MainActor
final class ClaimWithDeviceKeyTests: XCTestCase {
    private struct FixedKeys: DeviceKeys {
        func publicKey() throws -> String { "ed25519:11111111111111111111111111111111" }
    }

    private struct BrokenKeys: DeviceKeys {
        func publicKey() throws -> String { throw KeychainError(status: errSecNotAvailable) }
    }

    func testALiveClaimRecordsTheAccount() async throws {
        let flow = OnboardingFlow(api: FixtureClient(), names: FixtureNameDirectory(), isLive: true, keys: FixedKeys())
        flow.nameText = "frank"
        await flow.resolve(try XCTUnwrap(flow.name))

        let claimed = await flow.claim()
        XCTAssertTrue(claimed)
        XCTAssertEqual(flow.claimed, "frank" + FliqName.suffix)
    }

    func testNoDeviceKeyMeansNoClaim() async throws {
        let flow = OnboardingFlow(api: FixtureClient(), names: FixtureNameDirectory(), isLive: true, keys: BrokenKeys())
        flow.nameText = "frank"
        await flow.resolve(try XCTUnwrap(flow.name))

        let claimed = await flow.claim()
        XCTAssertFalse(claimed)
        XCTAssertEqual(flow.status, .unreachable)
    }
}
