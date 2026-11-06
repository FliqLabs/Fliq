import Foundation

/// Stands in until the API and the vault contract expose agent keys. Claude's caps, today's
/// spend and the refused attempt come from `spec/fixtures/payout.refused.json`, so the screen
/// shows the same numbers as the demo script.
struct FixtureAgentAPI: AgentAPI {
    var fixtures = FixtureClient()

    func agents(vault: String) async throws -> [Agent] {
        let refusal: Refusal = try fixtures.load("payout.refused")
        let verified: VerifiedAccount = try fixtures.load("verify.gtbank-0123456789")
        let claude = Agent(
            id: "agent_claude",
            name: "Claude",
            publicKey: "ed25519:demo-key-claude",
            policy: AgentPolicy(dailyCap: refusal.dailyCap, perPayout: refusal.perPayoutCap),
            usedToday: refusal.usedToday,
            events: [
                AgentEvent(id: "evt_paid", recipient: verified.accountName, amount: refusal.usedToday, currency: .ngn,
                           outcome: .paid),
                AgentEvent(id: "evt_refused", recipient: verified.accountName, amount: refusal.attempted, currency: .ngn,
                           outcome: .refused(reason: "over the daily cap")),
            ]
        )
        return [claude]
    }

    func connect(name: String, publicKey: String, policy: AgentPolicy, vault: String) async throws -> Agent {
        Agent(id: "agent_" + UUID().uuidString.prefix(8).lowercased(), name: name, publicKey: publicKey,
              policy: policy, usedToday: 0)
    }

    func update(_ agentId: String, policy: AgentPolicy, vault: String) async throws {}

    func revoke(_ agentId: String, vault: String) async throws {}
}
