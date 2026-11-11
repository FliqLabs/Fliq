import Foundation

/// What the phone reads from the chain itself: the signing key's nonce, the latest final block and contract views.
struct NEARRPC: Sendable {
    let url: URL
    var session: URLSession = .shared

    struct AccessKey: Decodable { let nonce: UInt64 }
    struct Block: Decodable {
        struct Header: Decodable {
            let height: UInt64
            let hash: String?
        }
        let header: Header
    }
    struct Account: Decodable, Equatable {
        /// yoctoNEAR as a decimal string: it does not fit in 64 bits.
        let amount: String
        let storageUsage: UInt64
        enum CodingKeys: String, CodingKey {
            case amount
            case storageUsage = "storage_usage"
        }
    }
    struct Outcome: Equatable {
        let hash: String
        /// Nil when every action succeeded.
        let failure: String?
    }
    private struct StorageBalance: Decodable { let total: String }
    private struct StorageBounds: Decodable { let min: String }
    private struct View: Decodable { let result: [UInt8] }
    private struct VaultConfig: Decodable {
        let approvedUSDC: String
        enum CodingKeys: String, CodingKey { case approvedUSDC = "approved_usdc_token_contract" }
    }

    func accessKeyNonce(account: String, publicKey: String) async throws -> UInt64 {
        let key: AccessKey = try await call("query", [
            "request_type": "view_access_key", "finality": "final", "account_id": account, "public_key": publicKey,
        ])
        return key.nonce
    }

    func finalBlockHeight() async throws -> UInt64 {
        try await finalBlock().height
    }

    func finalBlock() async throws -> Block.Header {
        let block: Block = try await call("block", ["finality": "final"])
        return block.header
    }

    /// Nil when no account has this id yet.
    func account(_ id: String) async throws -> Account? {
        do {
            return try await call("query", ["request_type": "view_account", "finality": "final", "account_id": id])
        } catch let error as NEARRPCError where error.isUnknownAccount {
            return nil
        }
    }

    /// Whether the account can hold this token. A token contract refuses transfers to accounts it has not registered.
    func isRegistered(_ account: String, on token: String) async throws -> Bool {
        let balance: StorageBalance? = try await view(token, "storage_balance_of", ["account_id": account])
        return balance != nil
    }

    /// What registering one account on the token costs, in yoctoNEAR.
    func registrationCost(on token: String) async throws -> Yocto {
        let bounds: StorageBounds = try await view(token, "storage_balance_bounds", [:])
        guard let cost = Yocto(decimal: bounds.min) else { throw NEARRPCError(message: "unreadable storage bounds") }
        return cost
    }

    /// Sends a signed transaction and waits until every receipt has run.
    func send(signedTransaction: String) async throws -> Outcome {
        let reply: [String: Any] = try await rawCall("send_tx", ["signed_tx_base64": signedTransaction, "wait_until": "EXECUTED_OPTIMISTIC"])
        let transaction = reply["transaction"] as? [String: Any]
        let status = reply["status"] as? [String: Any] ?? [:]
        let failure = status["Failure"].map { failure -> String in
            guard let data = try? JSONSerialization.data(withJSONObject: failure) else { return "The transaction failed." }
            return String(decoding: data, as: UTF8.self)
        }
        return Outcome(hash: transaction?["hash"] as? String ?? "", failure: failure)
    }

    /// The USDC contract the vault takes deposits from.
    func vaultUSDC(vault: String) async throws -> String {
        let config: VaultConfig = try await view(vault, "get_config", [:])
        return config.approvedUSDC
    }

    /// USDC held by the account itself, outside the vault, in base units.
    func usdcBalance(of account: String, usdc: String) async throws -> TokenAmount {
        let units: String = try await view(usdc, "ft_balance_of", ["account_id": account])
        guard let value = Int64(units) else { throw NEARRPCError(message: "unreadable balance") }
        return TokenAmount(baseUnits: value)
    }

    private func view<Result: Decodable>(_ contract: String, _ method: String, _ args: [String: String]) async throws -> Result {
        let encoded = try JSONSerialization.data(withJSONObject: args).base64EncodedString()
        let reply: View = try await call("query", [
            "request_type": "call_function", "finality": "final", "account_id": contract, "method_name": method, "args_base64": encoded,
        ])
        return try JSONDecoder().decode(Result.self, from: Data(reply.result))
    }

    private struct Reply<Result: Decodable>: Decodable {
        struct Failure: Decodable {
            struct Cause: Decodable { let name: String? }
            let message: String?
            let cause: Cause?
        }
        let result: Result?
        let error: Failure?
    }

    private func call<Result: Decodable>(_ method: String, _ params: [String: String]) async throws -> Result {
        let (data, _) = try await session.data(for: request(method, params))
        let reply = try JSONDecoder().decode(Reply<Result>.self, from: data)
        guard let result = reply.result else {
            throw NEARRPCError(message: reply.error?.message ?? "no result", cause: reply.error?.cause?.name)
        }
        return result
    }

    private func rawCall(_ method: String, _ params: [String: String]) async throws -> [String: Any] {
        let (data, _) = try await session.data(for: request(method, params))
        let reply = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        if let result = reply["result"] as? [String: Any] { return result }
        let error = reply["error"] as? [String: Any]
        let cause = (error?["cause"] as? [String: Any])?["name"] as? String
        throw NEARRPCError(message: error?["message"] as? String ?? "no result", cause: cause)
    }

    private func request(_ method: String, _ params: [String: String]) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": "fliq", "method": method, "params": params])
        return request
    }
}

struct NEARRPCError: Error, Equatable {
    let message: String
    var cause: String?

    var isUnknownAccount: Bool { cause == "UNKNOWN_ACCOUNT" }
}
