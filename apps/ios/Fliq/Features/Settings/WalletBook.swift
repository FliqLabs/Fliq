import Foundation
import Observation

/// Wallets the user named, kept on the server so every iPhone and the web see them. The Keychain keeps a copy so the
/// list is there at launch, before the server answers. Wallets sent to from this iPhone but never named are listed
/// apart: they have no name to show, so they are offered for naming instead of being uploaded.
@MainActor
@Observable
final class WalletBook {
    private static let key = "wallets.saved"

    private(set) var saved: [SavedWallet]
    private(set) var sentBefore: [SentAddresses.Entry]

    private let keychain: Keychain?
    private let recents: SentAddresses
    @ObservationIgnored private var api: (any FliqAPI)?

    /// Pass nil to keep everything in memory, for previews and tests.
    init(keychain: Keychain? = Keychain(service: "cash.fliq.wallets"), recents: SentAddresses = SentAddresses()) {
        self.keychain = keychain
        self.recents = recents
        saved = Self.ordered(keychain?.load([SavedWallet].self, for: Self.key) ?? [])
        sentBefore = []
        sentBefore = unsaved(recents.entries())
    }

    func connect(_ api: any FliqAPI) {
        self.api = api
    }

    /// The server's list becomes the list here.
    func sync() async {
        guard let api, let listed = try? await api.wallets().items else { return }
        apply(listed)
    }

    /// Saves on the server first: the address is checked there, and a second save of the same one only renames it.
    @discardableResult
    func save(_ input: SavedWalletInput) async throws -> SavedWallet {
        guard let api else { throw APIError.unexpected(status: 503) }
        let wallet = try await api.saveWallet(input)
        apply(saved.filter { $0.walletId != wallet.walletId } + [wallet])
        return wallet
    }

    /// Shows the new name at once, and puts the old one back if the server says no.
    func rename(_ wallet: SavedWallet, to label: String) async throws {
        let before = saved
        replace(wallet.walletId) { $0.label = label }
        guard let api else { return }
        do {
            let renamed = try await api.renameWallet(id: wallet.walletId, label: label)
            replace(wallet.walletId) { $0 = renamed }
        } catch {
            apply(before)
            throw error
        }
    }

    func remove(_ wallet: SavedWallet) async throws {
        let before = saved
        apply(saved.filter { $0.walletId != wallet.walletId })
        guard let api else { return }
        do {
            try await api.deleteWallet(id: wallet.walletId)
        } catch {
            apply(before)
            throw error
        }
    }

    /// A send just left: the wallet moves to the top now, as the server will list it.
    func markSent(chain: String, address: String, at date: Date = .now) {
        replace(where: { $0.isSame(chain: chain, address: address) }) { $0.lastSentAt = date }
        sentBefore = unsaved(recents.entries())
    }

    func wallet(chain: String, address: String) -> SavedWallet? {
        saved.first { $0.isSame(chain: chain, address: address) }
    }

    func clear() {
        saved = []
        keychain?.delete(Self.key)
    }

    /// Most recently sent to first, then those never sent to, newest saved first.
    static func ordered(_ wallets: [SavedWallet]) -> [SavedWallet] {
        wallets.sorted { lhs, rhs in
            switch (lhs.lastSentAt, rhs.lastSentAt) {
            case let (left?, right?) where left != right: left > right
            case (_?, nil): true
            case (nil, _?): false
            default: lhs.createdAt != rhs.createdAt ? lhs.createdAt > rhs.createdAt : lhs.walletId > rhs.walletId
            }
        }
    }

    private func replace(_ id: String, _ change: (inout SavedWallet) -> Void) {
        replace(where: { $0.walletId == id }, change)
    }

    private func replace(where matches: (SavedWallet) -> Bool, _ change: (inout SavedWallet) -> Void) {
        var all = saved
        guard let index = all.firstIndex(where: matches) else { return }
        change(&all[index])
        apply(all)
    }

    private func apply(_ wallets: [SavedWallet]) {
        saved = Self.ordered(wallets)
        sentBefore = unsaved(recents.entries())
        try? keychain?.save(saved, for: Self.key)
    }

    /// The Recent list on Send to only holds NEAR wallets.
    private func unsaved(_ entries: [SentAddresses.Entry]) -> [SentAddresses.Entry] {
        entries.filter { wallet(chain: WalletChain.near.rawValue, address: $0.address) == nil }
    }
}
