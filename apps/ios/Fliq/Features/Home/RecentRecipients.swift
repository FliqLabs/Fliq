import Foundation

/// Someone Recipients can pay: a saved bank account, a fliq user or a saved wallet, with when they were last paid.
struct RecentRecipient: Identifiable, Hashable {
    enum Kind: Hashable {
        case bank(VerifiedAccount)
        case person(RecentPerson)
        case wallet(SavedWallet)
    }

    let kind: Kind
    let lastPaid: Date?

    var id: String {
        switch kind {
        case .bank(let account): "bank-\(account.recipientId ?? account.bank + "-" + account.number.suffix(4))"
        case .person(let person): "person-\(person.nearAccount)"
        case .wallet(let wallet): "wallet-\(wallet.walletId)"
        }
    }

    var name: String {
        switch kind {
        case .bank(let account): account.accountName.localizedCapitalized
        case .person(let person): person.displayName ?? FliqName.display(person.nearAccount)
        case .wallet(let wallet): wallet.label
        }
    }

    /// A wallet keeps its whole name: "Tunde's Binance" cut to "Tunde's" says less.
    var firstName: String {
        if case .wallet = kind { return name }
        return name.split(separator: " ").first.map(String.init) ?? name
    }

    /// "GTBank 4821" for a bank account, "@tobi" for a fliq user, "7xKX…9fGh" for a wallet.
    var detail: String {
        switch kind {
        case .bank(let account): "\(account.institution) \(account.number.suffix(4))"
        case .person(let person): FliqName.display(person.nearAccount)
        case .wallet(let wallet): wallet.shortAddress
        }
    }

    var isBank: Bool {
        if case .bank = kind { return true }
        return false
    }

    var isWallet: Bool {
        if case .wallet = kind { return true }
        return false
    }

    var photoURL: URL? {
        guard case .person(let person) = kind else { return nil }
        return person.photoUrl.flatMap(URL.init(string:))
    }

    var accessibilityLabel: String {
        guard case .wallet(let wallet) = kind else { return "Pay \(name), \(detail)" }
        return "Send to \(name), \(wallet.network?.name ?? wallet.chain) wallet ending \(wallet.address.suffix(4))"
    }

    func matches(_ query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return true }
        var fields = [name, detail]
        if case .person(let person) = kind { fields.append(person.nearAccount) }
        if case .wallet(let wallet) = kind { fields += [wallet.address, wallet.network?.name ?? wallet.chain] }
        return fields.contains { $0.localizedCaseInsensitiveContains(trimmed) }
    }
}

/// Merges saved bank accounts, fliq users and saved wallets into one list, most recently paid first.
enum RecentRecipients {
    enum Filter: Hashable, CaseIterable {
        case all, banks, stablecoins

        var title: String {
            switch self {
            case .all: "All"
            case .banks: "Banks"
            case .stablecoins: "Stablecoins"
            }
        }

        func includes(_ recipient: RecentRecipient) -> Bool {
            switch self {
            case .all: true
            case .banks: recipient.isBank
            case .stablecoins: recipient.isWallet
            }
        }
    }

    static func filter(_ recipients: [RecentRecipient], by filter: Filter, search: String) -> [RecentRecipient] {
        recipients.filter { filter.includes($0) && $0.matches(search) }
    }

    /// A payment the app knows about, reduced to who it went to and when.
    struct Payment: Equatable {
        enum To: Equatable {
            case bank(code: String, last4: String)
            case person(nearAccount: String)
        }

        let to: To
        let at: Date
    }

    /// Payouts started on this iPhone and the account's history. Refused attempts did not pay anyone.
    static func payments(entries: [ActivityStore.Entry], history: [ActivityItem]) -> [Payment] {
        let local = entries.map { Payment(to: .bank(code: $0.payout.account.bank, last4: String($0.payout.account.number.suffix(4))), at: $0.startedAt) }
        let listed = history.compactMap { item -> Payment? in
            switch item.kind {
            case .payout:
                guard let code = item.party.institution, let last4 = item.party.accountLast4 else { return nil }
                return Payment(to: .bank(code: code, last4: last4), at: item.at)
            case .transferOut:
                return item.party.nearAccount.map { Payment(to: .person(nearAccount: $0), at: item.at) }
            default:
                return nil
            }
        }
        return local + listed
    }

    /// Paid recipients come first, newest first. Those never paid keep the order they were given in, after them.
    static func merge(accounts: [VerifiedAccount], people: [RecentPerson], payments: [Payment], wallets: [SavedWallet] = []) -> [RecentRecipient] {
        var banks: [VerifiedAccount] = []
        for account in accounts where !banks.contains(where: { $0.isSame(as: account) }) {
            banks.append(account)
        }
        var seen = Set<String>()
        let users = people.filter { seen.insert($0.nearAccount).inserted }

        let recipients = banks.map { account in
            RecentRecipient(kind: .bank(account), lastPaid: latest(payments, to: .bank(code: account.bank, last4: String(account.number.suffix(4)))))
        } + users.map { person in
            RecentRecipient(kind: .person(person), lastPaid: [person.lastPaidAt, latest(payments, to: .person(nearAccount: person.nearAccount))].compactMap { $0 }.max())
        } + wallets.map { RecentRecipient(kind: .wallet($0), lastPaid: $0.lastSentAt) }

        return recipients.enumerated().sorted { lhs, rhs in
            switch (lhs.element.lastPaid, rhs.element.lastPaid) {
            case let (left?, right?) where left != right: left > right
            case (_?, nil): true
            case (nil, _?): false
            default: lhs.offset < rhs.offset
            }
        }.map(\.element)
    }

    private static func latest(_ payments: [Payment], to recipient: Payment.To) -> Date? {
        payments.filter { $0.to == recipient }.map(\.at).max()
    }
}
