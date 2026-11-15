import CryptoKit
import XCTest
@testable import Fliq

/// Backing up an account and adding a new iPhone to it, against a stubbed chain and relayer.
final class AccountRecoveryTests: XCTestCase {
    private struct Approves: Biometrics {
        let answer: Bool
        func approve(_ reason: String) async -> Bool { answer }
    }

    private let account = "ada.fliqaccount.testnet"
    private let device = RecoveryKey(key: Curve25519.Signing.PrivateKey())

    override func setUp() { RecoveryStub.reset() }
    override func tearDown() { RecoveryStub.reset() }

    private func makeRecovery(_ backups: MemoryRecoveryKeys, approves: Bool = true) -> AccountRecovery {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecoveryStub.self]
        let session = URLSession(configuration: configuration)
        let client = HTTPClient(
            baseURL: URL(string: "https://api.test/v1")!, apiKey: "rt_test", sessions: SessionVault(keychain: nil), session: session, retryDelays: [.zero, .zero]
        )
        return AccountRecovery(
            api: client,
            rpc: NEARRPC(url: URL(string: "https://rpc.test")!, session: session),
            device: device,
            recovery: backups,
            biometrics: Approves(answer: approves),
            account: { [account] in account },
            pollInterval: .zero
        )
    }

    /// Answers `view_access_key` from `onChain`, blocks with height 1000, and accepts every relay.
    private func chain(_ onChain: Set<String>) {
        RecoveryStub.respond { request in
            if request.url?.path == "/v1/relays" {
                return (200, Data(#"{"status":"succeeded","tx_hash":"tx1","delegate_hash":"h1","sender_id":"a","receiver_id":"a","failures":[]}"#.utf8))
            }
            let body = (try? JSONSerialization.jsonObject(with: Data(reading: request.httpBodyStream!))) as? [String: Any]
            if body?["method"] as? String == "block" { return (200, Data(#"{"result":{"header":{"height":1000}}}"#.utf8)) }
            let key = (body?["params"] as? [String: String])?["public_key"] ?? ""
            return onChain.contains(key)
                ? (200, Data(#"{"result":{"nonce":41,"permission":"FullAccess"}}"#.utf8))
                : (200, Data(#"{"result":{"error":"access key \#(key) does not exist while viewing","logs":[]}}"#.utf8))
        }
    }

    private func relayed() throws -> Data {
        let request = try XCTUnwrap(RecoveryStub.requests.first { $0.url?.path == "/v1/relays" })
        let sent = try JSONSerialization.jsonObject(with: Data(reading: request.httpBodyStream!)) as? [String: String]
        return try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(sent?["signed_delegate"])))
    }

    func testAnAccountWithOnlyThisIPhoneIsNotBackedUp() async throws {
        chain([try device.publicKey()])
        let state = await makeRecovery(MemoryRecoveryKeys()).state()
        XCTAssertEqual(state, .notBackedUp)
    }

    func testBackingUpAddsTheSyncedKeySignedByThisIPhone() async throws {
        let backups = MemoryRecoveryKeys()
        chain([try device.publicKey()])
        try await makeRecovery(backups).backUp()

        let backup = try XCTUnwrap(backups.existing(for: account))
        let expected = KeyDelegate(
            account: account,
            change: .add(try XCTUnwrap(NEARKey.decode(try backup.publicKey()))),
            nonce: 42,
            maxBlockHeight: 1000 + DelegateAction.lifetimeBlocks,
            publicKey: device.key.publicKey.rawRepresentation
        )
        let sent = try relayed()
        XCTAssertEqual(sent.dropLast(65), expected.borsh)
        XCTAssertTrue(device.key.publicKey.isValidSignature(sent.suffix(64), for: expected.signingHash))
    }

    func testOnceTheBackupIsOnChainTheAccountIsBackedUp() async throws {
        let backups = MemoryRecoveryKeys()
        let backup = try backups.key(for: account)
        chain([try device.publicKey(), try backup.publicKey()])
        let state = await makeRecovery(backups).state()
        XCTAssertEqual(state, .backedUp)
    }

    func testANewIPhoneWithTheBackupCanBeAddedSignedByTheBackup() async throws {
        let backups = MemoryRecoveryKeys()
        let backup = try XCTUnwrap(try backups.key(for: account) as? RecoveryKey)
        chain([try backup.publicKey()])
        let recovery = makeRecovery(backups)
        let before = await recovery.state()
        XCTAssertEqual(before, .canRestore)

        try await recovery.restore()
        let expected = KeyDelegate(
            account: account,
            change: .add(device.key.publicKey.rawRepresentation),
            nonce: 42,
            maxBlockHeight: 1000 + DelegateAction.lifetimeBlocks,
            publicKey: backup.key.publicKey.rawRepresentation
        )
        let sent = try relayed()
        XCTAssertEqual(sent.dropLast(65), expected.borsh)
        XCTAssertTrue(backup.key.publicKey.isValidSignature(sent.suffix(64), for: expected.signingHash))
    }

    func testRestoringNeedsFaceIDAndABackup() async throws {
        let backups = MemoryRecoveryKeys()
        let backup = try backups.key(for: account)
        chain([try backup.publicKey()])
        await XCTAssertThrowsRecovery(.notApproved) { try await self.makeRecovery(backups, approves: false).restore() }
        await XCTAssertThrowsRecovery(.noBackup) { try await self.makeRecovery(MemoryRecoveryKeys()).restore() }
        XCTAssertTrue(RecoveryStub.requests.allSatisfy { $0.url?.path != "/v1/relays" })
    }

    /// Answers the key list with `listed` full-access keys and one function-call key, and accepts every relay.
    private func chain(listing listed: [String]) {
        RecoveryStub.respond { request in
            if request.url?.path == "/v1/relays" {
                return (200, Data(#"{"status":"succeeded","tx_hash":"tx1","delegate_hash":"h1","sender_id":"a","receiver_id":"a","failures":[]}"#.utf8))
            }
            let body = (try? JSONSerialization.jsonObject(with: Data(reading: request.httpBodyStream!))) as? [String: Any]
            if body?["method"] as? String == "block" { return (200, Data(#"{"result":{"header":{"height":1000}}}"#.utf8)) }
            if (body?["params"] as? [String: String])?["request_type"] == "view_access_key_list" {
                let full = listed.map { #"{"public_key":"\#($0)","access_key":{"nonce":1,"permission":"FullAccess"}}"# }
                let agent = #"{"public_key":"ed25519:agent","access_key":{"nonce":1,"permission":{"FunctionCall":{"receiver_id":"v","method_names":["payout"],"allowance":null}}}}"#
                return (200, Data(#"{"result":{"keys":[\#((full + [agent]).joined(separator: ","))]}}"#.utf8))
            }
            return (200, Data(#"{"result":{"nonce":41,"permission":"FullAccess"}}"#.utf8))
        }
    }

    func testKeysListsWhatCanMoveMoneyWithThisIPhoneFirstAndLeavesAgentKeysOut() async throws {
        let backups = MemoryRecoveryKeys()
        let backup = try backups.key(for: account).publicKey()
        let stranger = NEARKey.encode(Curve25519.Signing.PrivateKey().publicKey.rawRepresentation)
        chain(listing: [stranger, backup, try device.publicKey()])

        let keys = await makeRecovery(backups).keys()
        XCTAssertEqual(keys?.map(\.holder), [.thisIPhone, .backup, .other])
        XCTAssertEqual(keys?.last?.publicKey, stranger)
    }

    func testRemovingAnotherDeviceIsSignedByThisIPhone() async throws {
        let stranger = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation
        chain(listing: [try device.publicKey(), NEARKey.encode(stranger)])
        try await makeRecovery(MemoryRecoveryKeys()).remove(AccountKey(publicKey: NEARKey.encode(stranger), holder: .other))

        let expected = KeyDelegate(
            account: account, change: .remove(stranger), nonce: 42, maxBlockHeight: 1000 + DelegateAction.lifetimeBlocks,
            publicKey: device.key.publicKey.rawRepresentation
        )
        let sent = try relayed()
        XCTAssertEqual(sent.dropLast(65), expected.borsh)
        XCTAssertTrue(device.key.publicKey.isValidSignature(sent.suffix(64), for: expected.signingHash))
    }

    func testTurningOffBackupForgetsTheKeyAndThisIPhoneCanNeverBeRemoved() async throws {
        let backups = MemoryRecoveryKeys()
        let backup = try backups.key(for: account).publicKey()
        chain(listing: [try device.publicKey(), backup])
        let recovery = makeRecovery(backups)

        try await recovery.remove(AccountKey(publicKey: backup, holder: .backup))
        XCTAssertNil(backups.existing(for: account))

        RecoveryStub.reset()
        await XCTAssertThrowsRecovery(.cannotRemoveThisIPhone) {
            try await recovery.remove(AccountKey(publicKey: try self.device.publicKey(), holder: .thisIPhone))
        }
        XCTAssertTrue(RecoveryStub.requests.isEmpty)
    }

    func testANewIPhoneWithNoBackupCannotSignAndAnUnreadableChainIsNeverGuessed() async throws {
        chain([])
        let stuck = await makeRecovery(MemoryRecoveryKeys()).state()
        XCTAssertEqual(stuck, .cannotSign)

        RecoveryStub.respond { _ in (500, Data()) }
        let unknown = await makeRecovery(MemoryRecoveryKeys()).state()
        XCTAssertNil(unknown)
    }

    private func XCTAssertThrowsRecovery(_ expected: RecoveryError, _ work: @escaping () async throws -> Void, file: StaticString = #filePath, line: UInt = #line) async {
        do {
            try await work()
            XCTFail("Expected \(expected)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? RecoveryError, expected, file: file, line: line)
        }
    }
}

private extension Data {
    init(reading stream: InputStream) {
        self.init()
        stream.open()
        defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            append(buffer, count: count)
        }
    }
}

private final class RecoveryStub: URLProtocol, @unchecked Sendable {
    typealias Responder = @Sendable (URLRequest) throws -> (Int, Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var responder: Responder = { _ in (500, Data()) }
    nonisolated(unsafe) private static var seen: [URLRequest] = []

    static var requests: [URLRequest] { lock.withLock { seen } }

    static func respond(_ responder: @escaping Responder) {
        lock.withLock { self.responder = responder }
    }

    static func reset() {
        lock.withLock {
            responder = { _ in (500, Data()) }
            seen = []
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let respond = Self.lock.withLock {
            Self.seen.append(request)
            return Self.responder
        }
        do {
            let (status, data) = try respond(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
