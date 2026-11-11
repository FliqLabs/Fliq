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

    private(set) var entries: [Entry] = []
    private(set) var history: [ActivityItem] = []

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

    /// A payout started here stays as its live local row until the server lists it.
    var rows: [Row] {
        let listed = Set(history.map(\.refId))
        let pending = entries.filter { !listed.contains($0.id) }.map(Row.local)
        return (pending + history.map(Row.history)).sorted { $0.date > $1.date }
    }
}
