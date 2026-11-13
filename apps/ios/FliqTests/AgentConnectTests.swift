import CryptoKit
import XCTest
@testable import Fliq

@MainActor
final class AgentConnectTests: XCTestCase {
    private func makeFlow(key: AgentKey = AgentKey.generate()) async -> AgentConnectFlow {
        let store = AgentStore(api: FixtureAgentAPI(), vault: { "fliq-vault.testnet" })
        await store.load()
        return AgentConnectFlow(store: store, rpcURL: "https://rpc.testnet.near.org", activationPause: .zero, makeKey: { key })
    }

    func testAGeneratedKeyIsAValidNEARKeyPair() throws {
        let key = AgentKey.generate()
        let publicBytes = try XCTUnwrap(NEARKey.decode(key.publicKey))
        let secret = try XCTUnwrap(Self.base58Decode(String(key.secretKey.dropFirst("ed25519:".count))))

        XCTAssertEqual(secret.count, 64)
        XCTAssertEqual(secret.suffix(32), publicBytes)
        let signer = try Curve25519.Signing.PrivateKey(rawRepresentation: secret.prefix(32))
        XCTAssertEqual(signer.publicKey.rawRepresentation, publicBytes)
        XCTAssertNotEqual(AgentKey.generate().publicKey, key.publicKey)
    }

    func testTheSummaryReadsInPlainWords() {
        XCTAssertEqual(
            AgentPolicy.starter.summary(for: "Claude"),
            "Claude can pay up to ₦15,000 at a time, ₦30,000 a day, to bank accounts in Nigeria and Kenya, for a year or until you revoke it."
        )
        let naira = AgentPolicy(dailyCap: 40_000, perPayout: 10_000, currencies: [.ngn])
        XCTAssertTrue(naira.summary(for: "Codex").hasSuffix("to bank accounts in Nigeria, for a year or until you revoke it."))
    }

    func testConnectAlwaysSaysWhyItCantGoYet() async {
        let flow = await makeFlow()
        flow.choose(.claude)
        XCTAssertNil(flow.blocker)

        flow.policy = AgentPolicy(dailyCap: 10_000, perPayout: 20_000)
        XCTAssertEqual(flow.blocker, "The per-payment limit can't be more than the daily limit.")

        flow.useExistingKey()
        flow.policy = .starter
        flow.existingKey = "abc"
        XCTAssertEqual(flow.blocker, "Paste a key that starts with ed25519:")
        flow.existingKey = AgentKey.generate().publicKey
        XCTAssertNil(flow.blocker)
    }

    func testTheSecretIsShownOnceThenDropped() async throws {
        let key = AgentKey.generate()
        let flow = await makeFlow(key: key)
        flow.choose(.claude)

        await flow.connect()

        XCTAssertEqual(flow.step, .done)
        let setup = try XCTUnwrap(flow.setup)
        XCTAssertEqual(setup.secretKey, key.secretKey)
        XCTAssertTrue(setup.snippet.hasPrefix("claude mcp add fliq"))
        XCTAssertTrue(setup.snippet.contains("FLIQ_AGENT_PRIVATE_KEY=\(key.secretKey)"))
        XCTAssertTrue(setup.snippet.contains("FLIQ_VAULT_CONTRACT_ID=fliq-vault.testnet"))

        flow.finish()
        XCTAssertNil(flow.setup)
    }

    func testAnExistingKeyConnectsWithoutASecretToShow() async {
        let flow = await makeFlow()
        flow.useExistingKey()
        flow.existingKey = AgentKey.generate().publicKey

        await flow.connect()

        XCTAssertEqual(flow.step, .done)
        XCTAssertNil(flow.setup)
    }

    func testEachAppGetsItsOwnSetupAndLogo() {
        func setup(_ app: AgentApp) -> AgentSetup {
            AgentSetup(app: app, accountId: "claude-frank.fliq.near", secretKey: "ed25519:secret", rpcURL: "https://rpc", vault: "vault")
        }
        XCTAssertTrue(setup(.openai).snippet.hasPrefix("[mcp_servers.fliq]"))
        XCTAssertTrue(setup(.cursor).snippet.contains("\"mcpServers\""))
        XCTAssertEqual(AgentApp.guess(name: "Claude"), .claude)
        XCTAssertEqual(AgentApp.guess(name: "Payroll bot"), .other)
        XCTAssertEqual(AgentApp.claude.logoAsset, "Agent-claude")
        XCTAssertNotNil(UIImage(named: "Agent-claude"))
        XCTAssertNotNil(UIImage(named: "Agent-openai"))
        XCTAssertNotNil(UIImage(named: "Agent-cursor"))
    }

    private static func base58Decode(_ text: String) -> Data? {
        let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
        var bytes: [UInt8] = []
        for character in text {
            guard var carry = alphabet.firstIndex(of: character) else { return nil }
            for index in bytes.indices {
                carry += Int(bytes[index]) * 58
                bytes[index] = UInt8(carry & 0xFF)
                carry >>= 8
            }
            while carry > 0 {
                bytes.append(UInt8(carry & 0xFF))
                carry >>= 8
            }
        }
        let zeros = text.prefix { $0 == "1" }.count
        return Data(repeating: 0, count: zeros) + Data(bytes.reversed())
    }
}
