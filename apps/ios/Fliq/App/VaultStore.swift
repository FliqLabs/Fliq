import Foundation
import Observation

/// The vault balance as this app last saw it. A mirror only: the NEAR contract holds the real
/// balance and enforces it, so a stale number here can never let more money leave.
@MainActor
@Observable
final class VaultStore {
    private(set) var balance: TokenAmount

    init(balance: TokenAmount = .zero) {
        self.balance = balance
    }

    func credit(_ amount: TokenAmount) {
        balance = TokenAmount(baseUnits: balance.baseUnits + amount.baseUnits)
    }

    func sync(_ live: VaultBalance) {
        balance = live.available
    }

    func debit(_ amount: TokenAmount) {
        balance = TokenAmount(baseUnits: max(0, balance.baseUnits - amount.baseUnits))
    }
}
