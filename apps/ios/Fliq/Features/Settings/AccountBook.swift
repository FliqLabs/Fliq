import Foundation
import Observation

/// Your own bank account and the accounts you chose to save, kept in the Keychain.
@MainActor
@Observable
final class AccountBook {
    private enum Key {
        static let own = "accounts.own"
        static let saved = "accounts.saved"
    }

    private(set) var own: VerifiedAccount?
    private(set) var saved: [VerifiedAccount]

    private let keychain: Keychain?

    /// Pass nil to keep everything in memory, for previews and tests.
    init(keychain: Keychain? = Keychain(service: "cash.fliq.accounts")) {
        self.keychain = keychain
        own = keychain?.load(VerifiedAccount.self, for: Key.own)
        saved = keychain?.load([VerifiedAccount].self, for: Key.saved) ?? []
    }

    func setOwn(_ account: VerifiedAccount?) {
        own = account
        if let account { try? keychain?.save(account, for: Key.own) } else { keychain?.delete(Key.own) }
    }

    func save(_ account: VerifiedAccount) {
        guard account != own, !saved.contains(where: { $0.bank == account.bank && $0.number == account.number }) else { return }
        saved.insert(account, at: 0)
        persist()
    }

    func remove(_ account: VerifiedAccount) {
        saved.removeAll { $0 == account }
        persist()
    }

    func clear() {
        own = nil
        saved = []
        keychain?.delete(Key.own)
        keychain?.delete(Key.saved)
    }

    private func persist() {
        try? keychain?.save(saved, for: Key.saved)
    }
}
