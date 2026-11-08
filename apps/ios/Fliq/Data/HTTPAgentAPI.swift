import Foundation

/// Agent keys through the API: `GET /agents`, `POST /agents`, `PATCH` and `DELETE /agents/{id}`.
/// Each change comes back with vault calls the device signs and relays; the vault only holds a policy the user signed.
struct HTTPAgentAPI: AgentAPI {
    let client: HTTPClient
    let relay: DelegateRelay
    /// The user's NEAR account, which signs every step.
    let owner: @Sendable () async -> String?

    struct Cap: Codable, Equatable {
        let amount: String
        let currency: String
    }

    struct LiveAgent: Decodable {
        let agentId: String
        let name: String
        let publicKey: String
        let state: String
        let dailyCap: Cap
        let perPayoutCap: Cap
        let currencies: [String]
        let savedAccountsOnly: Bool
        let spentToday: Cap
    }

    private struct AgentList: Decodable {
        let agents: [LiveAgent]
    }

    private struct AgentChange: Decodable {
        let agent: LiveAgent
    }

    struct Limits: Encodable, Equatable {
        let dailyCap: Cap
        let perPayoutCap: Cap
        let currencies: [String]
        let savedAccountsOnly: Bool

        init(_ policy: AgentPolicy) {
            // The caps are set in one currency: naira when the agent may pay out in naira.
            let currency = policy.currencies.contains(.ngn) || policy.currencies.isEmpty ? "NGN" : "KES"
            dailyCap = Cap(amount: String(policy.dailyCap), currency: currency)
            perPayoutCap = Cap(amount: String(policy.perPayout), currency: currency)
            currencies = policy.currencies.map { $0.rawValue.uppercased() }.sorted()
            savedAccountsOnly = policy.savedAccountsOnly
        }
    }

    private struct ConnectRequest: Encodable {
        let name: String
        let publicKey: String
        let dailyCap: Cap
        let perPayoutCap: Cap
        let currencies: [String]
        let savedAccountsOnly: Bool
    }

    func agents(vault: String) async throws -> [Agent] {
        let list: AgentList = try await client.send("GET", "agents")
        return list.agents.map(Self.agent)
    }

    func connect(name: String, publicKey: String, policy: AgentPolicy, vault: String) async throws -> Agent {
        let limits = Limits(policy)
        let body = ConnectRequest(
            name: name, publicKey: publicKey, dailyCap: limits.dailyCap, perPayoutCap: limits.perPayoutCap,
            currencies: limits.currencies, savedAccountsOnly: limits.savedAccountsOnly
        )
        let change = try await client.sendRaw("POST", "agents", body: body, headers: ["Idempotency-Key": UUID().uuidString])
        var agent = try await signSteps(change, reason: "Let \(name) pay from your vault")
        agent.status = .active
        return agent
    }

    func update(_ agentId: String, policy: AgentPolicy, vault: String) async throws {
        let change = try await client.sendRaw("PATCH", "agents/\(agentId)", body: Limits(policy))
        _ = try await signSteps(change, reason: "Change this agent's limits")
    }

    func revoke(_ agentId: String, vault: String) async throws {
        let change = try await client.sendRaw("DELETE", "agents/\(agentId)")
        _ = try await signSteps(change, reason: "Revoke this agent")
    }

    /// Signs and relays the steps in order, each with the next nonce, and returns the agent they change.
    private func signSteps(_ change: Data, reason: String) async throws -> Agent {
        let agent = try FliqJSON.decoder().decode(AgentChange.self, from: change).agent
        let steps = try SignStep.steps(in: change)
        guard let owner = await owner() else { throw TransferError.notSetUp }
        for step in steps {
            _ = try await relay.submit(from: owner, reason: reason) { nonce, height, key in
                .step(step, from: owner, nonce: nonce, blockHeight: height, publicKey: key)
            }
        }
        return Self.agent(agent)
    }

    static func agent(_ live: LiveAgent) -> Agent {
        Agent(
            id: live.agentId,
            name: live.name,
            publicKey: live.publicKey,
            policy: AgentPolicy(
                dailyCap: Int(live.dailyCap.amount) ?? 0,
                perPayout: Int(live.perPayoutCap.amount) ?? 0,
                currencies: Set(live.currencies.compactMap { Currency(rawValue: $0.lowercased()) }),
                savedAccountsOnly: live.savedAccountsOnly
            ),
            usedToday: Int(live.spentToday.amount) ?? 0,
            status: live.state == "revoked" ? .revoked : .active
        )
    }
}

/// One vault call the API asks the device to sign. The args stay JSON with their keys untouched, exactly as signed.
struct SignStep: Equatable, Sendable {
    let receiverId: String
    let methodName: String
    let args: Data
    let gas: UInt64
    let deposit: Yocto

    struct Unsupported: Error, Equatable {
        let kind: String
    }

    /// The `steps` of an AgentChange. Only function calls are signed on the phone; fliq's relayer creates accounts itself.
    static func steps(in change: Data) throws -> [SignStep] {
        guard
            let root = try JSONSerialization.jsonObject(with: change) as? [String: Any],
            let steps = root["steps"] as? [[String: Any]]
        else { throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "No steps in the answer.")) }
        return try steps.map { step in
            let kind = step["kind"] as? String ?? ""
            guard
                kind == "function_call",
                let receiver = step["receiver_id"] as? String,
                let method = step["method_name"] as? String,
                let gas = (step["gas"] as? String).flatMap(UInt64.init),
                let deposit = (step["deposit"] as? String).flatMap(Yocto.init(decimal:))
            else { throw Unsupported(kind: kind) }
            let args = try JSONSerialization.data(
                withJSONObject: step["args"] as? [String: Any] ?? [:], options: [.sortedKeys, .withoutEscapingSlashes]
            )
            return SignStep(receiverId: receiver, methodName: method, args: args, gas: gas, deposit: deposit)
        }
    }
}
