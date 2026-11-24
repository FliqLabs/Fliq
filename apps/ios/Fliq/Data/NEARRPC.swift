import Foundation

/// What the phone reads from the chain itself: the signing key's nonce, the latest final block and contract views.
struct NEARRPC: Sendable {
    let url: URL
    var session: URLSession = .shared

    /// A `view_access_key` answer. Some RPC providers, FastNEAR among them, answer a missing key with HTTP 200 and a
    /// result that carries an `error` text instead of a nonce, so both are read.
    private struct AccessKeyLookup: Decodable {
        let nonce: UInt64?
        let error: String?
    }
    static let requestTimeout: TimeInterval = 10
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

    /// The key's nonce. A key that is not on the account throws a `NEARRPCError` whose `isUnknownAccessKey` is true,
    /// whichever way the provider says so.
    func accessKeyNonce(account: String, publicKey: String) async throws -> UInt64 {
        let found: AccessKeyLookup = try await call("query", [
            "request_type": "view_access_key", "finality": "final", "account_id": account, "public_key": publicKey,
        ])
        if let nonce = found.nonce { return nonce }
        if let error = found.error, error.contains("does not exist") {
            throw NEARRPCError(message: error, cause: NEARRPCError.unknownAccessKey)
        }
        throw NEARRPCError(message: found.error ?? "unreadable access key")
    }

    /// Whether `publicKey` is an access key of `account` right now. Anything but a clear yes or no is thrown, never guessed.
    func hasAccessKey(account: String, publicKey: String) async throws -> Bool {
        do {
            _ = try await accessKeyNonce(account: account, publicKey: publicKey)
            return true
        } catch let error as NEARRPCError where error.isUnknownAccessKey {
            return false
        }
    }

    /// The public keys with full access to `account`: the ones that can move its money.
    func fullAccessKeys(account: String) async throws -> [String] {
        struct List: Decodable {
            struct Entry: Decodable {
                struct Access: Decodable {
                    let isFull: Bool

                    init(from decoder: Decoder) throws {
                        let permission = try decoder.container(keyedBy: Keys.self).decode(Permission.self, forKey: .permission)
                        isFull = permission.isFull
                    }

                    enum Keys: String, CodingKey { case permission }
                }

                /// "FullAccess" as text, or an object describing a function-call key.
                struct Permission: Decodable {
                    let isFull: Bool

                    init(from decoder: Decoder) throws {
                        isFull = (try? decoder.singleValueContainer().decode(String.self)) == "FullAccess"
                    }
                }

                let publicKey: String
                let accessKey: Access

                enum CodingKeys: String, CodingKey {
                    case publicKey = "public_key"
                    case accessKey = "access_key"
                }
            }

            let keys: [Entry]
        }
        let list: List = try await call("query", ["request_type": "view_access_key_list", "finality": "final", "account_id": account])
        return list.keys.filter(\.accessKey.isFull).map(\.publicKey)
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
        let (data, response) = try await session.data(for: request(method, params))
        let reply: Reply<Result>
        do {
            reply = try JSONDecoder().decode(Reply<Result>.self, from: data)
        } catch {
            // A gateway error page is not JSON: say what the server answered rather than how it failed to decode.
            try Self.checkStatus(response)
            throw error
        }
        if reply.error == nil { try Self.checkStatus(response) }
        guard let result = reply.result else {
            throw NEARRPCError(message: reply.error?.message ?? "no result", cause: reply.error?.cause?.name)
        }
        return result
    }

    private func rawCall(_ method: String, _ params: [String: String]) async throws -> [String: Any] {
        let (data, response) = try await session.data(for: request(method, params))
        guard let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            try Self.checkStatus(response)
            throw NEARRPCError(message: "unreadable reply")
        }
        let error = reply["error"] as? [String: Any]
        if error == nil { try Self.checkStatus(response) }
        if let result = reply["result"] as? [String: Any] { return result }
        let cause = (error?["cause"] as? [String: Any])?["name"] as? String
        throw NEARRPCError(message: error?["message"] as? String ?? "no result", cause: cause)
    }

    private func request(_ method: String, _ params: [String: String]) throws -> URLRequest {
        var request = URLRequest(url: url, timeoutInterval: Self.requestTimeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": "fliq", "method": method, "params": params])
        return request
    }

    /// A JSON-RPC error keeps its own cause whatever the HTTP status. Without one, only a 2xx answer counts.
    private static func checkStatus(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        throw NEARRPCError(message: "HTTP \(http.statusCode)", status: http.statusCode)
    }
}

struct NEARRPCError: Error, Equatable {
    static let unknownAccessKey = "UNKNOWN_ACCESS_KEY"

    let message: String
    var cause: String?
    /// Set when the RPC answered with a non-2xx HTTP status and no JSON-RPC error.
    var status: Int?

    var isUnknownAccount: Bool { cause == "UNKNOWN_ACCOUNT" }
    var isUnknownAccessKey: Bool { cause == Self.unknownAccessKey }
}
