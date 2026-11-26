import Foundation

/// A wallet the user named so they can send to it again, as `GET /wallets` lists it.
struct SavedWallet: Codable, Hashable, Identifiable, Sendable {
    let walletId: String
    var label: String
    let chain: String
    let address: String
    var token: String?
    let createdAt: Date
    var lastSentAt: Date?

    var id: String { walletId }
    var network: WalletChain? { WalletChain(rawValue: chain) }
    var shortAddress: String { WalletAddress.short(address, on: chain) }

    func isSame(chain other: String, address otherAddress: String) -> Bool {
        chain == other && WalletAddress.same(address, otherAddress, on: chain)
    }
}

struct SavedWalletList: Decodable, Sendable {
    let items: [SavedWallet]
}

struct SavedWalletInput: Encodable, Equatable, Sendable {
    let label: String
    let chain: String
    let address: String
    var token: String?
}

/// The networks a wallet can be saved on: the ones the send flow can reach.
enum WalletChain: String, CaseIterable, Identifiable, Sendable {
    case near, solana, base, tron, bnb

    var id: String { rawValue }

    var name: String {
        switch self {
        case .near: "NEAR"
        case .solana: "Solana"
        case .base: "Base"
        case .tron: "Tron"
        case .bnb: "BNB Chain"
        }
    }

    /// The chain's image in the asset catalog.
    var image: String {
        switch self {
        case .near: "ChainNEAR"
        case .solana: "ChainSolana"
        case .base: "ChainBase"
        case .tron: "ChainTron"
        case .bnb: "ChainBnb"
        }
    }

    /// What arrives there. The user always pays in USDC.
    var token: String { self == .tron || self == .bnb ? "usdt" : "usdc" }

    /// Enough of a network to check an address against.
    var network: SendNetwork {
        self == .near ? .near : SendNetwork(chain: rawValue, name: name, minimum: "0", etaSeconds: 0, available: true, token: token)
    }

    /// The network an address plainly belongs to, so a pasted address picks its own. An 0x address fits Base and BNB
    /// Chain alike, so it says nothing.
    static func guess(_ address: String) -> WalletChain? {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed.hasPrefix("0x") { return nil }
        if SendAddress.isTron(trimmed) { return .tron }
        if SendAddress.problem(trimmed, on: WalletChain.solana.network) == nil { return .solana }
        // Any short word is a valid NEAR name, so only a full one counts, or the network would change mid-typing.
        let near = WithdrawAddress.normalized(trimmed)
        if near.hasSuffix(".near") || WithdrawAddress.isImplicit(near), WithdrawAddress.problem(near, own: nil, contracts: []) == nil { return .near }
        return nil
    }
}

enum WalletAddress {
    static let labelLimit = 40

    /// "7xKX…9fGh". A NEAR name is shown whole: it is already short and readable.
    static func short(_ address: String, on chain: String) -> String {
        if chain == WalletChain.near.rawValue, !WithdrawAddress.isImplicit(address) { return address }
        let head = address.hasPrefix("0x") ? 6 : 4
        return address.count > head + 6 ? "\(address.prefix(head))…\(address.suffix(4))" : address
    }

    /// NEAR names are lower case. Other addresses are kept as typed: on Solana and Tron case matters.
    static func normalized(_ typed: String, on chain: WalletChain) -> String {
        chain == .near ? WithdrawAddress.normalized(typed) : typed.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Why an address can't be saved on a chain, or nil when it can. Empty means nothing has been typed yet.
    static func problem(_ typed: String, on chain: WalletChain) -> String? {
        let address = normalized(typed, on: chain)
        guard chain == .near else { return SendAddress.problem(address, on: chain.network) }
        if address.isEmpty { return "" }
        let raw = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if SendAddress.isTron(raw) { return "That's a Tron address. Choose Tron above." }
        // Lower-cased, a Solana address can pass for a NEAR name. NEAR names never have capitals.
        if raw != address, SendAddress.problem(raw, on: WalletChain.solana.network) == nil { return "That's a Solana address. Choose Solana above." }
        return WithdrawAddress.problem(address, own: nil, contracts: [])
    }

    static func labelProblem(_ typed: String) -> String? {
        let label = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if label.isEmpty { return "" }
        return label.unicodeScalars.count > labelLimit ? "Keep the name to \(labelLimit) characters." : nil
    }

    /// EVM addresses mean the same in any case.
    static func same(_ a: String, _ b: String, on chain: String) -> Bool {
        chain == "base" || chain == "bnb" ? a.lowercased() == b.lowercased() : a == b
    }
}
