import Foundation
import Observation

@MainActor
@Observable
final class HomeModel {
    private(set) var rate: Rate?
    private(set) var rateFailed = false

    private let api: any FliqAPI
    private let vault: VaultStore

    init(api: any FliqAPI, vault: VaultStore = VaultStore()) {
        self.api = api
        self.vault = vault
    }

    /// The spec has no balance endpoint yet, so this mirrors top-ups and payouts made here.
    /// Send stays enabled at zero: the vault enforces caps and balance on chain either way.
    var balance: TokenAmount { vault.balance }

    var hasBalance: Bool { balance > .zero }

    func load() async {
        do {
            rate = try await api.rate(.usdc, .ngn)
            rateFailed = false
        } catch {
            rateFailed = true
        }
    }
}
