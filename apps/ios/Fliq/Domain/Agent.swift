import Foundation

/// What the vault contract lets one agent key do. Amounts are whole naira, as in the spec.
struct AgentPolicy: Equatable, Sendable {
    static let step = 10_000

    var dailyCap: Int
    var perPayout: Int
    var currencies: Set<Currency> = [.ngn]
    var savedAccountsOnly = true

    var isValid: Bool { dailyCap > 0 && perPayout > 0 && perPayout <= dailyCap && !currencies.isEmpty }
}

struct AgentEvent: Identifiable, Equatable, Sendable {
    enum Outcome: Equatable, Sendable {
        case paid, refused(reason: String)
    }

    let id: String
    let recipient: String
    let amount: Int
    let currency: Currency
    let outcome: Outcome
    var at: Date?
}

struct Agent: Identifiable, Equatable, Sendable {
    enum Status: Equatable, Sendable { case active, revoked }

    let id: String
    var name: String
    var publicKey: String
    var policy: AgentPolicy
    var usedToday: Int
    var status: Status = .active
    var events: [AgentEvent] = []

    var remainingToday: Int { max(0, policy.dailyCap - usedToday) }
}

protocol AgentAPI: Sendable {
    func agents(vault: String) async throws -> [Agent]
    func connect(name: String, publicKey: String, policy: AgentPolicy, vault: String) async throws -> Agent
    func update(_ agentId: String, policy: AgentPolicy, vault: String) async throws
    func revoke(_ agentId: String, vault: String) async throws
}
