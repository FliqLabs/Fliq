import Foundation

/// A network USDC can be sent to from a fliq account.
struct SendNetwork: Decodable, Equatable, Identifiable, Sendable {
    let chain: String
    let name: String
    let minimum: String
    let etaSeconds: Int
    let available: Bool

    var id: String { chain }
    var isNEAR: Bool { chain == "near" }
    var minimumAmount: TokenAmount { TokenAmount(decimalString: minimum) ?? .zero }

    /// A direct transfer the user signs themselves: no swap, no fee, a few seconds.
    static let near = SendNetwork(chain: "near", name: "NEAR", minimum: "0.01", etaSeconds: 3, available: true)

    /// Where a delivered send can be looked up, for the receipt.
    func explorer(transaction hash: String) -> URL? {
        switch chain {
        case "solana": URL(string: "https://solscan.io/tx/\(hash)")
        case "base": URL(string: "https://basescan.org/tx/\(hash)")
        default: nil
        }
    }
}

/// A send to a wallet on another network, as `POST /sends` and `GET /sends/{id}` return it.
struct WalletSend: Decodable, Equatable, Sendable {
    enum State: String, Decodable, Sendable {
        case awaiting, moving, delivered, refunded, failed, expired

        var isFinal: Bool { self != .awaiting && self != .moving }
    }

    struct Deposit: Decodable, Equatable, Sendable {
        /// The NEAR account the user sends the USDC to. NEAR Intents delivers it from there.
        let address: String
        let expiresAt: Date
    }

    let sendId: String
    let state: State
    let chain: String
    let to: String
    let amount: String
    let receives: String
    let fee: String
    let etaSeconds: Int
    let deposit: Deposit
    let destinationTx: String?

    var receivesAmount: TokenAmount { TokenAmount(decimalString: receives) ?? .zero }
    var feeAmount: TokenAmount { TokenAmount(decimalString: fee) ?? .zero }
}

protocol SendsAPI: Sendable {
    func networks() async throws -> [SendNetwork]
    /// Asks what will arrive and where to send it. Nothing moves until the user signs.
    func start(chain: String, address: String, amount: TokenAmount, idempotencyKey: String) async throws -> WalletSend
    func send(id: String) async throws -> WalletSend
}

/// What an address must look like on each network. The API checks again; this answers while the user types.
enum SendAddress {
    private static let base58 = Set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    static func problem(_ address: String, on network: SendNetwork) -> String? {
        if address.isEmpty { return "" }
        switch network.chain {
        case "solana":
            let shaped = (32...44).contains(address.count) && address.allSatisfy(base58.contains)
            if address.hasPrefix("0x") { return "That's a Base or Ethereum address. Choose Base above to send it there." }
            return shaped && NEARKey.base58Decode(address)?.count == 32 ? nil : "That isn't a Solana address."
        case "base":
            let hex = address.dropFirst(2)
            let shaped = address.hasPrefix("0x") && hex.count == 40 && hex.allSatisfy(\.isHexDigit)
            return shaped ? nil : "That isn't a Base address. It starts with 0x and has 42 characters."
        default:
            return "fliq can't send to \(network.name) yet."
        }
    }

    static func short(_ address: String) -> String {
        address.count > 16 ? "\(address.prefix(6))…\(address.suffix(4))" : address
    }
}
