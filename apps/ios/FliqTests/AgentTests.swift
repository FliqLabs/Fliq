import XCTest
@testable import Fliq

@MainActor
final class AgentTests: XCTestCase {
    private func makeStore() async -> AgentStore {
        let store = AgentStore(api: FixtureAgentAPI(), vault: { "frank.fliq.near" })
        await store.load()
        return store
    }

    func testClaudeShowsTheCanonicalCapsAndTheRefusal() async throws {
        let store = await makeStore()
        let claude = try XCTUnwrap(store.agents.first)

        XCTAssertEqual(claude.policy.dailyCap, 150_000)
        XCTAssertEqual(claude.policy.perPayout, 50_000)
        XCTAssertEqual(claude.usedToday, 30_000)
        XCTAssertEqual(claude.remainingToday, 120_000)
        XCTAssertTrue(claude.events.contains { $0.amount == 500_000 && $0.outcome != .paid })
    }

    func testLimitsMustStayConsistent() async throws {
        let store = await makeStore()
        let claude = try XCTUnwrap(store.agents.first)

        let tooBig = AgentPolicy(dailyCap: 40_000, perPayout: 50_000)
        let rejected = await store.update(claude.id, policy: tooBig)
        XCTAssertFalse(rejected, "Per payout above the daily cap is refused before it reaches the vault")

        var raised = claude.policy
        raised.dailyCap += AgentPolicy.step
        let saved = await store.update(claude.id, policy: raised)
        XCTAssertTrue(saved)
        XCTAssertEqual(store.agent(id: claude.id)?.policy.dailyCap, 160_000)
    }

    func testRevokeAndConnect() async throws {
        let store = await makeStore()
        let claude = try XCTUnwrap(store.agents.first)

        let revoked = await store.revoke(claude.id)
        XCTAssertTrue(revoked)
        XCTAssertEqual(store.agent(id: claude.id)?.status, .revoked)

        let bot = await store.connect(name: "Payroll bot", publicKey: "ed25519:abcdefghijkl",
                                      policy: AgentPolicy(dailyCap: 40_000, perPayout: 20_000))
        XCTAssertEqual(bot?.usedToday, 0)
        XCTAssertEqual(store.agents.count, 2)
    }
}
