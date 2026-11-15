import Foundation

struct HTTPSendsAPI: SendsAPI {
    let client: HTTPClient

    private struct NetworkList: Decodable { let networks: [SendNetwork] }

    private struct Request: Encodable {
        let chain: String
        let address: String
        let amount: String
    }

    func networks() async throws -> [SendNetwork] {
        let list: NetworkList = try await client.send("GET", "sends/networks", query: ["tokens": "usdc,usdt"])
        return list.networks
    }

    func start(chain: String, address: String, amount: TokenAmount, idempotencyKey: String) async throws -> WalletSend {
        try await client.send(
            "POST", "sends", body: Request(chain: chain, address: address, amount: amount.decimalString), headers: ["Idempotency-Key": idempotencyKey]
        )
    }

    func send(id: String) async throws -> WalletSend {
        try await client.send("GET", "sends/\(id)")
    }
}

/// The sample-data build: Solana and Base, a three cent fee, and a send that is delivered on the second look.
actor FixtureSendsAPI: SendsAPI {
    static let fee = TokenAmount(baseUnits: 30_000)
    private var started: [String: WalletSend] = [:]
    private var looks: [String: Int] = [:]

    func networks() async throws -> [SendNetwork] {
        [
            SendNetwork(chain: "solana", name: "Solana", minimum: "1.00", etaSeconds: 40, available: true),
            SendNetwork(chain: "base", name: "Base", minimum: "1.00", etaSeconds: 40, available: true),
            SendNetwork(chain: "tron", name: "Tron", minimum: "10.00", etaSeconds: 75, available: true, token: "usdt"),
            SendNetwork(chain: "bnb", name: "BNB Chain", minimum: "1.00", etaSeconds: 25, available: true, token: "usdt"),
        ]
    }

    func start(chain: String, address: String, amount: TokenAmount, idempotencyKey: String) async throws -> WalletSend {
        let receives = TokenAmount(baseUnits: max(0, amount.baseUnits - Self.fee.baseUnits))
        let send = WalletSend(
            sendId: "snd_\(started.count + 1)", state: .awaiting, chain: chain, to: address, amount: amount.decimalString,
            receives: receives.decimalString, fee: Self.fee.decimalString, etaSeconds: 40,
            deposit: WalletSend.Deposit(address: String(repeating: "a", count: 64), expiresAt: .now.addingTimeInterval(600)), destinationTx: nil
        )
        started[send.sendId] = send
        return send
    }

    func send(id: String) async throws -> WalletSend {
        guard let send = started[id] else { throw APIError.unexpected(status: 404) }
        looks[id, default: 0] += 1
        let delivered = looks[id, default: 0] >= 2
        return WalletSend(
            sendId: send.sendId, state: delivered ? .delivered : .moving, chain: send.chain, to: send.to, amount: send.amount, receives: send.receives,
            fee: send.fee, etaSeconds: send.etaSeconds, deposit: send.deposit, destinationTx: delivered ? "demo" : nil
        )
    }
}
