import Foundation
import Observation

@MainActor
@Observable
final class HomeModel {
    private(set) var rate: Rate?
    private(set) var rateFailed = false
    private(set) var me: User?

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


    var photoURL: URL? { me?.photoUrl.flatMap(URL.init(string:)) }

    /// Runs on every return to Home, so a photo changed in Settings shows straight away.
    func loadProfile() async {
        if let user = try? await api.me() { me = user }
    }

    func load() async {
        await loadProfile()
        do {
            rate = try await api.rate(.usdc, .ngn)
            rateFailed = false
        } catch {
            rateFailed = true
        }
    }
}
