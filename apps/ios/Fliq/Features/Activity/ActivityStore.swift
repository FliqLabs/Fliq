import Foundation
import Observation

/// Everything that moved money, newest first: the account's history from `GET /activity`, plus payouts this
/// device started that the server has not listed yet, refreshed as each one moves.
@MainActor
@Observable
final class ActivityStore {
    enum Source: Hashable, Sendable {
        case mine, agent(String)
    }

    struct Entry: Identifiable, Equatable {
        var payout: Payout
        let source: Source
        let startedAt: Date

        var id: String { payout.payoutId }
    }

    enum Row: Identifiable, Equatable {
        case local(Entry)
        case history(ActivityItem)

        var id: String {
            switch self {
            case .local(let entry): "local-" + entry.id
            case .history(let item): item.id
            }
        }

        var date: Date {
            switch self {
            case .local(let entry): entry.startedAt
            case .history(let item): item.at
            }
        }

        var isAgent: Bool {
            switch self {
            case .local(let entry): entry.source != .mine
            case .history(let item): item.agent != nil
            }
        }
    }

    /// A Naira bank transfer this iPhone started. The server only lists the deposit once the money reaches Solana, and
    /// then as "Received from Solana", so the app shows it from the moment the user has paid and keeps the bank's name.
    struct BankDeposit: Codable, Equatable, Sendable {
        let depositId: String
        let naira: Int
        let usd: String
        let startedAt: Date
    }

    private(set) var entries: [Entry] = []
    private(set) var history: [ActivityItem] = []
    private(set) var bankDeposits: [BankDeposit]
    private let defaults: UserDefaults?
    private static let bankKey = "activity.bankDeposits"
    /// A bank transfer the server never lists by then was not paid, or Paj refunded it.
    static let bankDepositWindow: TimeInterval = 3 * 60 * 60

    init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        bankDeposits = defaults?.data(forKey: Self.bankKey).flatMap { try? JSONDecoder().decode([BankDeposit].self, from: $0) } ?? []
    }

    #if DEBUG
    func setHistoryForTesting(_ items: [ActivityItem]) { history = items }
    #endif

    func recordBankDeposit(_ deposit: BankDeposit) {
        bankDeposits.removeAll { $0.depositId == deposit.depositId }
        bankDeposits.insert(deposit, at: 0)
        bankDeposits = Array(bankDeposits.prefix(30))
        defaults?.set(try? JSONEncoder().encode(bankDeposits), forKey: Self.bankKey)
    }

    func record(_ payout: Payout, source: Source = .mine, at date: Date = .now) {
        if let index = entries.firstIndex(where: { $0.id == payout.payoutId }) {
            entries[index].payout = payout
        } else {
            entries.insert(Entry(payout: payout, source: source, startedAt: date), at: 0)
        }
    }

    func entry(id: String) -> Entry? {
        entries.first { $0.id == id }
    }

    /// Bank and mobile money names and logos by code, so a row can say "Access Bank" and show its logo.
    private(set) var institutions: [String: Institution] = [:]

    func load(from api: any FliqAPI) async {
        await loadInstitutions(from: api)
        guard let list = try? await api.activity() else { return }
        history = list.items
    }

    private func loadInstitutions(from api: any FliqAPI) async {
        guard institutions.isEmpty else { return }
        for country in Country.allCases {
            for institution in (try? await api.institutions(in: country)) ?? [] {
                institutions[institution.code] = institution
            }
        }
    }

    var lines: [ActivityLine] {
        rows.map { ActivityLine($0, institutions: institutions) }
    }

    /// A payout started here stays as its live local row until the server lists it. So does a bank deposit, which also
    /// keeps its bank label once listed.
    var rows: [Row] {
        let listed = Set(history.map(\.refId))
        let pending = entries.filter { !listed.contains($0.id) }.map(Row.local)
        let banks = Dictionary(bankDeposits.map { ($0.depositId, $0) }, uniquingKeysWith: { first, _ in first })
        let now = Date.now
        let arriving = bankDeposits
            .filter { !listed.contains($0.depositId) && now.timeIntervalSince($0.startedAt) < Self.bankDepositWindow }
            .map { Row.history(.bankDeposit($0, status: "pending")) }
        let known = history.map { item in
            guard item.kind == .deposit, let bank = banks[item.refId] else { return Row.history(item) }
            return Row.history(.bankDeposit(bank, status: item.status, landed: item.usd, seconds: item.seconds, at: item.at, activityId: item.activityId))
        }
        return (pending + arriving + known).sorted { $0.date > $1.date }
    }
}
