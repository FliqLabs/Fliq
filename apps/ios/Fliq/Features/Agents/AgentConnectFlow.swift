import Foundation
import Observation

/// Connecting an agent: pick its app, set limits, then the phone makes the agent's key, registers it with the vault
/// and hands the user the setup to paste. The secret is held only until that screen closes.
@MainActor
@Observable
final class AgentConnectFlow {
    enum Step: Equatable {
        case chooseApp, limits, connecting, done, failed(String)
    }

    private(set) var step: Step = .chooseApp
    private(set) var app: AgentApp = .claude
    var name = AgentApp.claude.agentName
    var policy = AgentPolicy.starter
    /// "I already have a key": the agent made its own key and shows the public half.
    var existingKey = ""
    var usesExistingKey = false
    private(set) var setup: AgentSetup?
    private(set) var connected: Agent?
    /// False when the vault hadn't picked up the policy yet; it turns active on its own a moment later.
    private(set) var isActive = false

    private let store: AgentStore
    private let rpcURL: String
    private let apiURL: String
    private let makeKey: @Sendable () -> AgentKey
    private let activationPause: Duration

    init(
        store: AgentStore, rpcURL: String, apiURL: String = AgentSetup.bundledAPI, activationPause: Duration = .seconds(2),
        makeKey: @escaping @Sendable () -> AgentKey = AgentKey.generate
    ) {
        self.store = store
        self.rpcURL = rpcURL
        self.apiURL = apiURL
        self.activationPause = activationPause
        self.makeKey = makeKey
    }

    func choose(_ app: AgentApp) {
        self.app = app
        name = app.agentName
        usesExistingKey = false
        existingKey = ""
        step = .limits
    }

    func useExistingKey() {
        app = .other
        name = AgentApp.other.agentName
        usesExistingKey = true
        step = .limits
    }

    /// Why Connect can't run yet, in words; nil when it can.
    var blocker: String? {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Give the agent a name." }
        if !policy.isValid { return "The per-payment limit can't be more than the daily limit." }
        if usesExistingKey, AgentKey.validPublicKey(existingKey) == nil { return "Paste a key that starts with ed25519:" }
        return nil
    }

    var summary: String { policy.summary(for: name.trimmingCharacters(in: .whitespaces)) }

    func connect() async {
        guard blocker == nil else { return }
        step = .connecting
        let key = usesExistingKey ? nil : makeKey()
        let publicKey = key?.publicKey ?? AgentKey.validPublicKey(existingKey) ?? ""
        guard let agent = await store.connect(name: name.trimmingCharacters(in: .whitespaces), publicKey: publicKey, policy: policy) else {
            step = .failed(store.errorMessage ?? "The vault didn't accept this agent. Nothing changed.")
            return
        }
        connected = agent
        isActive = await store.waitUntilActive(agent.id, pause: activationPause)
        if let key {
            setup = AgentSetup(app: app, accountId: agent.id, secretKey: key.secretKey, rpcURL: rpcURL, apiURL: apiURL)
        }
        step = .done
    }

    func retry() {
        step = .limits
    }

    /// Called when the success screen closes: the secret is dropped and can't be shown again.
    func finish() {
        setup = nil
    }
}
