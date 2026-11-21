import Foundation
import Observation

/// Your own bank account and the accounts you chose to save. The server keeps them, so they survive deleting the app
/// and show on the web; the Keychain keeps a copy so the list is there at launch, before the server answers.
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
    @ObservationIgnored private var api: (any FliqAPI)?

    /// Pass nil to keep everything in memory, for previews and tests.
    init(keychain: Keychain? = Keychain(service: "cash.fliq.accounts")) {
        self.keychain = keychain
        own = keychain?.load(VerifiedAccount.self, for: Key.own)
        saved = keychain?.load([VerifiedAccount].self, for: Key.saved) ?? []
    }

    /// From here on every change is also made on the server.
    func connect(_ api: any FliqAPI) {
        self.api = api
    }

    /// Reads the accounts saved on the server, after first uploading any this iPhone kept only for itself (every
    /// account saved before 21 Nov). The server's list then becomes the list here.
    func sync() async {
        guard let api, var listed = try? await api.recipients().items else { return }
        for account in [own].compactMap({ $0 }) + saved where account.hasFullNumber {
            guard !listed.contains(where: { VerifiedAccount($0).isSame(as: account) }),
                  let uploaded = try? await api.saveRecipient(Self.input(account))
            else { continue }
            listed.append(uploaded)
        }
        if let own, !listed.contains(where: { $0.own == true }),
           let mine = listed.first(where: { VerifiedAccount($0).isSame(as: own) }) {
            try? await api.markOwnRecipient(id: mine.recipientId)
            listed = listed.map { $0.recipientId == mine.recipientId ? Self.markedOwn($0) : $0 }
        }
        apply(listed)
    }

    func setOwn(_ account: VerifiedAccount?) {
        own = account
        if let account { try? keychain?.save(account, for: Key.own) } else { keychain?.delete(Key.own) }
        guard let account, let api else { return }
        Task {
            var id = account.recipientId
            if id == nil { id = (try? await api.saveRecipient(Self.input(account)))?.recipientId }
            guard let id else { return }
            try? await api.markOwnRecipient(id: id)
            if own?.isSame(as: account) == true { own?.recipientId = id; persist() }
        }
    }

    func save(_ account: VerifiedAccount) {
        guard own.map({ !$0.isSame(as: account) }) ?? true, !saved.contains(where: { $0.isSame(as: account) }) else { return }
        saved.insert(account, at: 0)
        persist()
        guard account.recipientId == nil, account.hasFullNumber, let api else { return }
        Task {
            guard let uploaded = try? await api.saveRecipient(Self.input(account)) else { return }
            if let index = saved.firstIndex(where: { $0.isSame(as: account) }) { saved[index].recipientId = uploaded.recipientId }
            persist()
        }
    }

    func remove(_ account: VerifiedAccount) {
        saved.removeAll { $0.isSame(as: account) }
        persist()
        guard let id = account.recipientId, let api else { return }
        Task { try? await api.deleteRecipient(id: id) }
    }

    func clear() {
        own = nil
        saved = []
        keychain?.delete(Key.own)
        keychain?.delete(Key.saved)
    }

    /// The server's list, keeping the full number wherever this iPhone already had it.
    private func apply(_ listed: [Recipient]) {
        let known = [own].compactMap { $0 } + saved
        let accounts = listed.map { recipient -> VerifiedAccount in
            let restored = VerifiedAccount(recipient)
            guard var local = known.first(where: { $0.isSame(as: restored) }), local.hasFullNumber else { return restored }
            local.recipientId = recipient.recipientId
            return local
        }
        if let mine = listed.firstIndex(where: { $0.own == true }) { own = accounts[mine] }
        saved = accounts.enumerated().filter { listed[$0.offset].own != true }.map(\.element)
        if let own { try? keychain?.save(own, for: Key.own) }
        persist()
    }

    private func persist() {
        try? keychain?.save(saved, for: Key.saved)
        if let own { try? keychain?.save(own, for: Key.own) }
    }

    private static func input(_ account: VerifiedAccount) -> RecipientInput {
        RecipientInput(bank: account.bank, number: account.number, country: (account.country ?? .ng).rawValue)
    }

    private static func markedOwn(_ recipient: Recipient) -> Recipient {
        var marked = recipient
        marked.own = true
        return marked
    }
}
