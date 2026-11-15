import Foundation

/// The daily limit a user set on their own account, as `GET /me/limits` returns it.
struct Limits: Decodable, Equatable, Sendable {
    struct Pending: Decodable, Equatable, Sendable {
        /// Nil means the limit is being removed.
        let dailyLimit: String?
        let effectiveAt: Date

        // `dailyLimit` is null on purpose in a pending removal, so it is decoded as present-or-null.
        init(dailyLimit: String?, effectiveAt: Date) {
            self.dailyLimit = dailyLimit
            self.effectiveAt = effectiveAt
        }
    }

    /// Nil means the user has set no limit.
    let dailyLimit: String?
    let spentToday: String
    let remaining: String?
    let pending: Pending?

    static let none = Limits(dailyLimit: nil, spentToday: "0.00", remaining: nil, pending: nil)

    var limitAmount: TokenAmount? { dailyLimit.flatMap(TokenAmount.init(decimalString:)) }
    var spentAmount: TokenAmount { TokenAmount(decimalString: spentToday) ?? .zero }
    var remainingAmount: TokenAmount? { remaining.flatMap(TokenAmount.init(decimalString:)) }

    /// How much of the limit is used, from 0 to 1. Zero when there is no limit.
    var usedFraction: Double {
        guard let limit = limitAmount, limit > .zero else { return 0 }
        return min(1, Double(spentAmount.baseUnits) / Double(limit.baseUnits))
    }
}

protocol LimitsAPI: Sendable {
    func limits() async throws -> Limits
    /// A lower or first limit applies at once. A higher limit, or nil to remove it, waits 24 hours.
    func setDailyLimit(_ dollars: String?) async throws -> Limits
    func cancelPendingLimit() async throws -> Limits
}
