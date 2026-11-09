import Foundation
import Observation

@MainActor
@Observable
final class HomeModel {
    private(set) var rate: Rate?
    private(set) var rateFailed = false

    let inbox: WalletInbox
    private let api: any FliqAPI
    private let vault: VaultStore

    init(api: any FliqAPI, vault: VaultStore = VaultStore(), inbox: WalletInbox = WalletInbox()) {
        self.api = api
        self.vault = vault
        self.inbox = inbox
    }

    /// Send stays enabled at zero: the vault enforces caps and balance on chain either way.
    var balance: TokenAmount { vault.balance }


    func load() async {
        do {
            rate = try await api.rate(.usdc, .ngn)
            rateFailed = false
        } catch {
            rateFailed = true
        }
    }
}
