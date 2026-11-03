import Foundation
import Observation

/// Payouts made from this device, newest first. The spec has no list endpoint yet, so Activity
/// shows what this app sent; each entry is refreshed as its payout moves.
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

    private(set) var entries: [Entry] = []

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
}
