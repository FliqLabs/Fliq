import Foundation

/// The two reads a delegate action needs from the chain: the signing key's nonce and the latest final block.
struct NEARRPC: Sendable {
    let url: URL
    var session: URLSession = .shared

    struct AccessKey: Decodable { let nonce: UInt64 }
    struct Block: Decodable {
        struct Header: Decodable { let height: UInt64 }
        let header: Header
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
