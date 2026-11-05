import Foundation

/// A token on a chain the vault can be topped up from.
struct DepositSource: Hashable, Sendable, Identifiable {
    enum Group: String, CaseIterable, Sendable {
        case dollars = "Digital dollars"
        case bitcoin = "Bitcoin"
        case near = "Already on NEAR"
    }

    let token: String
    let chain: String
    let group: Group
    var minimum: TokenAmount?
    var note: String?

    var id: String { "\(token)-\(chain)" }
    var title: String { "\(token) on \(chain)" }
    var isDirect: Bool { group == .near }
}

/// A deposit address for one top-up. It takes any amount from `minimum` up, so nobody has to
/// say how much they will send first (NEAR Intents FLEX_INPUT).
struct DepositAddress: Equatable, Sendable {
    let source: DepositSource
    let address: String
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

/// Where a top-up is: seen on the source chain, moving to NEAR, in the vault.
struct DepositStatus: Equatable, Sendable {
    enum Stage: Int, Comparable, Sendable {
        case waiting, seen, bridging, landed

        static func < (lhs: Stage, rhs: Stage) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    let stage: Stage
    let received: TokenAmount?
    let seenAt: Date?
    let bridgingAt: Date?
    let landedAt: Date?
}

protocol DepositAPI: Sendable {
    func sources() async throws -> [DepositSource]
    func reserve(_ source: DepositSource, vault: String) async throws -> DepositAddress
    func status(of deposit: DepositAddress) async throws -> DepositStatus
}
