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
    enum Status: Equatable, Sendable { case pending, active, revoked }

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

/// The app an agent runs in. It picks the logo and the setup the user pastes into that app.
enum AgentApp: String, CaseIterable, Identifiable, Sendable {
    case claude, openai, cursor, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .claude: "Claude"
        case .openai: "ChatGPT or Codex"
        case .cursor: "Cursor"
        case .other: "Another agent"
        }
    }

    var detail: String {
        switch self {
        case .claude: "Claude Code and Claude Desktop"
        case .openai: "Codex in the terminal or the IDE"
        case .cursor: "The Cursor editor"
        case .other: "Any app that runs MCP servers"
        }
    }

    /// The name the agent gets unless the user changes it.
    var agentName: String {
        switch self {
        case .claude: "Claude"
        case .openai: "Codex"
        case .cursor: "Cursor"
        case .other: "My agent"
        }
    }

    var logoAsset: String? {
        switch self {
        case .claude: "Agent-claude"
        case .openai: "Agent-openai"
        case .cursor: "Agent-cursor"
        case .other: nil
        }
    }

    /// The app an existing agent most likely runs in, from its name.
    static func guess(name: String) -> AgentApp {
        let lower = name.lowercased()
        if lower.contains("claude") { return .claude }
        if lower.contains("codex") || lower.contains("chatgpt") || lower.contains("openai") || lower.contains("gpt") { return .openai }
        if lower.contains("cursor") { return .cursor }
        return .other
    }
}

extension AgentPolicy {
    /// About $20 a day and $10 a payment at today's naira rate, to Nigeria and Kenya.
    static let starter = AgentPolicy(dailyCap: 30_000, perPayout: 15_000, currencies: [.ngn, .kes])

    /// "Claude can pay up to ₦15,000 at a time, ₦30,000 a day, to bank accounts in Nigeria and Kenya, for a year."
    func summary(for name: String) -> String {
        let countries = [(Currency.ngn, Country.ng), (.kes, .ke)].filter { currencies.contains($0.0) }.map(\.1.name)
        let places = countries.count == 2 ? "\(countries[0]) and \(countries[1])" : countries.first ?? "no country"
        let local = Currency.ngn
        return "\(name) can pay up to \(Money.local(perPayout, local)) at a time, \(Money.local(dailyCap, local)) a day, "
            + "to bank accounts in \(places), for a year or until you revoke it."
    }
}
