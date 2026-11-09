import Foundation

/// What the phone reads from the chain itself: the signing key's nonce, the latest final block and contract views.
struct NEARRPC: Sendable {
    let url: URL
    var session: URLSession = .shared

    struct AccessKey: Decodable { let nonce: UInt64 }
    struct Block: Decodable {
        struct Header: Decodable { let height: UInt64 }
        let header: Header
    }
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
        let block: Block = try await call("block", ["finality": "final"])
        return block.header.height
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
        struct Failure: Decodable { let message: String? }
        let result: Result?
        let error: Failure?
    }

    private func call<Result: Decodable>(_ method: String, _ params: [String: String]) async throws -> Result {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": "fliq", "method": method, "params": params])
        let (data, _) = try await session.data(for: request)
        let reply = try JSONDecoder().decode(Reply<Result>.self, from: data)
        guard let result = reply.result else { throw NEARRPCError(message: reply.error?.message ?? "no result") }
        return result
    }
}

struct NEARRPCError: Error, Equatable {
    let message: String
}
