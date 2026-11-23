import Foundation
import Observation

/// The vault balance as this app last saw it. A mirror only: the NEAR contract holds the real
/// balance and enforces it, so a stale number here can never let more money leave.
@MainActor
@Observable
final class VaultStore {
    private(set) var balance: TokenAmount
    /// False only before the first balance is read, when nothing was kept from last time. Home shows a placeholder
    /// then, never a $0 that looks like an empty vault.
    private(set) var isKnown: Bool

    /// With `cache`, the last balance is kept on this iPhone and shown at launch while the live one loads.
    private let cache: UserDefaults?
    private static let key = "vault.lastBalance"

    init(balance: TokenAmount = .zero, cache: UserDefaults? = nil) {
        self.cache = cache
        if let saved = cache?.string(forKey: Self.key).flatMap(TokenAmount.init(decimalString:)) {
            self.balance = saved
            isKnown = true
        } else {
            self.balance = balance
            isKnown = cache == nil
        }
    }

    func credit(_ amount: TokenAmount) {
        balance = TokenAmount(baseUnits: balance.baseUnits + amount.baseUnits)
        save()
    }

    func sync(_ live: VaultBalance) {
        balance = live.available
        isKnown = true
        save()
    }

    func debit(_ amount: TokenAmount) {
        balance = TokenAmount(baseUnits: max(0, balance.baseUnits - amount.baseUnits))
        save()
    }

    /// Signing out: the next account must not see this one's balance.
    func forget() {
        cache?.removeObject(forKey: Self.key)
        balance = .zero
        isKnown = cache == nil
    }

    private func save() {
        cache?.set(balance.decimalString, forKey: Self.key)
    }
}
