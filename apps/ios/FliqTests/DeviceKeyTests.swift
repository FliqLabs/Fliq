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

    func testWithAPasskeyKeyTheAccountStartsWithItAndThenAddsThisIPhone() async throws {
        let passkey = try PasskeyKey(prf: SymmetricKey(data: Data(repeating: 7, count: 32)))
        let adds = RecordingRecovery()
        await adds.failFirst(2)
        let flow = OnboardingFlow(api: FixtureClient(), names: FixtureNameDirectory(), isLive: true, keys: FixedKeys(), recovery: adds)
        flow.passkeyKey = passkey
        flow.addRetryDelay = .zero
        flow.nameText = "frank"
        await flow.resolve(try XCTUnwrap(flow.name))

        let claimed = await flow.claim()
        await flow.addingThisIPhone?.value

        XCTAssertTrue(claimed)
        let added = await adds.added
        XCTAssertEqual(added.count, 1)
        XCTAssertEqual(added.first?.0, "frank" + FliqName.suffix)
        XCTAssertEqual(added.first?.1, try passkey.publicKey())
    }

    func testWithoutAPasskeyKeyTheAccountStartsWithThisIPhonesKey() async throws {
        let adds = RecordingRecovery()
        let flow = OnboardingFlow(api: FixtureClient(), names: FixtureNameDirectory(), isLive: true, keys: FixedKeys(), recovery: adds)
        flow.nameText = "frank"
        await flow.resolve(try XCTUnwrap(flow.name))

        let claimed = await flow.claim()

        XCTAssertTrue(claimed)
        XCTAssertNil(flow.addingThisIPhone)
        let added = await adds.added
        XCTAssertTrue(added.isEmpty)
    }
}

/// Records the iPhones added to an account, failing the first few times like a chain that has not caught up.
actor RecordingRecovery: AccountRecovering {
    private(set) var added: [(String, String)] = []
    var failuresLeft = 0
    func failFirst(_ count: Int) { failuresLeft = count }
    func state() async -> RecoveryState? { nil }
    func backUp() async throws {}
    func restore() async throws {}
    func restore(with passkey: any DeviceKeys) async throws {}
    func keys() async -> [AccountKey]? { nil }
    func remove(_ key: AccountKey) async throws {}
    func addThisIPhone(to account: String, with passkey: any DeviceKeys) async throws {
        if failuresLeft > 0 {
            failuresLeft -= 1
            throw RecoveryError.passkeyNotOnAccount
        }
        added.append((account, try passkey.publicKey()))
    }
}
