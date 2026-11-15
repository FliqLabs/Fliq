import Foundation

/// A token on a chain the vault can be topped up from, from `GET /deposits/sources`.
struct DepositSource: Hashable, Sendable, Identifiable {
    enum Group: String, CaseIterable, Sendable {
        case dollars, bitcoin, near

        var title: String {
            switch self {
            case .dollars: "Digital dollars"
            case .bitcoin: "Bitcoin"
            case .near: "Already on NEAR"
            }
        }
    }

    /// The API's ids: `usdc`, `solana`.
    let tokenId: String
    let chainId: String
    let group: Group
    var minimum: TokenAmount?
    var etaSeconds = 35
    /// False when NEAR Intents does not offer this source right now.
    var available = true
    /// Set for the user's own NEAR account, which needs nothing reserved.
    var address: String?

    var id: String { "\(tokenId)-\(chainId)" }
    var token: String { tokenId.uppercased() }
    var chain: String { Self.chainNames[chainId] ?? chainId.capitalized }
    var title: String { "\(token) on \(chain)" }
    var isDirect: Bool { group == .near }
    /// The chain's image in the asset catalog: ChainSolana, ChainNEAR, ChainBnb.
    var chainImage: String { "Chain" + (chainId == "near" ? "NEAR" : chainId.capitalized) }

    var eta: String {
        etaSeconds < 60 ? "~\(etaSeconds)s" : "~\(Int((Double(etaSeconds) / 60).rounded())) min"
    }

    private static let chainNames = ["near": "NEAR", "bnb": "BNB Smart Chain", "monad": "Monad"]
}

/// A deposit address for one top-up. It takes any amount from `minimum` up and lands it in the vault as USDC.
struct DepositAddress: Equatable, Sendable {
    let source: DepositSource
    /// Nil for a direct NEAR top-up, which has nothing to poll.
    var depositId: String?
    let address: String
    var memo: String?
    let minimum: TokenAmount
    let fee: TokenAmount
    let reservedUntil: Date
    let estimatedSeconds: Int
    /// True for fixture addresses. Nothing sent to them is received.
    let isDemo: Bool

    func landing(_ received: TokenAmount) -> TokenAmount {
        TokenAmount(baseUnits: max(0, received.baseUnits - fee.baseUnits))
    }
}

/// Where a top-up is: seen on the source chain, moving to NEAR, in the vault, or given back.
struct DepositStatus: Equatable, Sendable {
    enum Stage: Int, Comparable, Sendable {
        case waiting, seen, underpaid, bridging, landed
        case refunded = 10, expired, failed

        static func < (lhs: Stage, rhs: Stage) -> Bool { lhs.rawValue < rhs.rawValue }

        var isFinal: Bool { self == .landed || rawValue >= Stage.refunded.rawValue }
        /// The money will not reach the vault as it stands: too little was sent, or it was handed back, timed out or failed.
        var isNotComing: Bool { self == .underpaid || rawValue >= Stage.refunded.rawValue }
    }

    let stage: Stage
    let received: TokenAmount?
    let seenAt: Date?
    let bridgingAt: Date?
    let landedAt: Date?
    var landed: TokenAmount?
}

protocol DepositAPI: Sendable {
    func sources() async throws -> [DepositSource]
    func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress
    func status(of deposit: DepositAddress) async throws -> DepositStatus
}

/// The API refused to open an address for this source right now, for example NEAR Intents on a testnet server.
struct DepositUnavailable: Error, Equatable {
    let message: String
}
