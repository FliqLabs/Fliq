import Foundation
import Observation

/// Which notifications the owner wants. Stored on the device; nothing here is secret.
@MainActor
@Observable
final class Preferences {
    enum Notice: String, CaseIterable, Sendable {
        case received, payoutPaid, payoutRefunded, agentPaid, agentRefused, capAlmostReached, rateAlert, weeklySummary

        var title: String {
            switch self {
            case .received: "Received in your vault"
            case .payoutPaid: "Payout paid"
            case .payoutRefunded: "Payout refunded"
            case .agentPaid: "An agent paid"
            case .agentRefused: "An agent was refused"
            case .capAlmostReached: "Daily cap almost reached"
            case .rateAlert: "Rate alert"
            case .weeklySummary: "Weekly summary"
            }
        }

        var detail: String? {
            switch self {
            case .capAlmostReached: "At 80%"
            case .rateAlert: "When $1 beats ₦1,400"
            default: nil
            }
        }

        var onByDefault: Bool { self != .rateAlert && self != .weeklySummary }
    }

    private(set) var notices: Set<Notice>

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.stringArray(forKey: "prefs.notices")
        notices = stored.map { Set($0.compactMap(Notice.init)) } ?? Set(Notice.allCases.filter(\.onByDefault))
    }

    func isOn(_ notice: Notice) -> Bool { notices.contains(notice) }

    func set(_ notice: Notice, _ on: Bool) {
        if on { notices.insert(notice) } else { notices.remove(notice) }
        defaults.set(notices.map(\.rawValue).sorted(), forKey: "prefs.notices")
    }
}
