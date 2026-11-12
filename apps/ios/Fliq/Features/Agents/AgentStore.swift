import Foundation
import Observation

/// The agent keys allowed to pay from this vault. Every change is written to the vault
/// contract by the API; this store only reflects what was accepted.
@MainActor
@Observable
final class AgentStore {
    private(set) var agents: [Agent] = []
    private(set) var isLoaded = false
    private(set) var errorMessage: String?

    private let api: any AgentAPI
    private let vault: () -> String

    init(api: any AgentAPI, vault: @escaping () -> String) {
        self.api = api
        self.vault = vault
    }

    var vaultAccount: String { vault() }

    func load() async {
        guard !isLoaded else { return }
        do {
            agents = try await api.agents(vault: vault())
            isLoaded = true
        } catch {
            errorMessage = "Couldn't load your agents."
        }
    }

    /// Re-reads the agents until this one is active, so the screen only says "connected" once the vault agrees.
    func waitUntilActive(_ agentId: String, tries: Int = 10, pause: Duration = .seconds(2)) async -> Bool {
        for _ in 0..<tries {
            if agent(id: agentId)?.status == .active { return true }
            if let fresh = try? await api.agents(vault: vault()), fresh.contains(where: { $0.id == agentId }) { agents = fresh }
            if agent(id: agentId)?.status == .active { return true }
            try? await Task.sleep(for: pause)
        }
        return agent(id: agentId)?.status == .active
    }

    func agent(id: String) -> Agent? {
        agents.first { $0.id == id }
    }

    func connect(name: String, publicKey: String, policy: AgentPolicy) async -> Agent? {
        guard policy.isValid else { return nil }
        do {
            let agent = try await api.connect(name: name, publicKey: publicKey, policy: policy, vault: vault())
            agents.append(agent)
            return agent
        } catch {
            errorMessage = "The vault didn't accept this agent. Nothing changed."
            return nil
        }
    }

    func update(_ agentId: String, policy: AgentPolicy) async -> Bool {
        guard policy.isValid, let index = agents.firstIndex(where: { $0.id == agentId }) else { return false }
        do {
            try await api.update(agentId, policy: policy, vault: vault())
            agents[index].policy = policy
            return true
        } catch {
            errorMessage = "The new limits weren't saved."
            return false
        }
    }

    func revoke(_ agentId: String) async -> Bool {
        guard let index = agents.firstIndex(where: { $0.id == agentId }) else { return false }
        do {
            try await api.revoke(agentId, vault: vault())
            agents[index].status = .revoked
            return true
        } catch {
            errorMessage = "The key wasn't revoked. Try again."
            return false
        }
    }
}
