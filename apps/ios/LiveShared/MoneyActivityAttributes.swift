import ActivityKit
import Foundation

/// Money on its way, shown in the Dynamic Island and on the Lock Screen. Shared by the app and the FliqLive widget.
/// The API pushes `ContentState` by these exact key names, so renaming one breaks the pushed updates.
struct MoneyActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable, Sendable {
        var step: Int
        var steps: Int
        var status: String
        var done: Bool
        var failed: Bool

        var progress: Double {
            guard steps > 0 else { return 0 }
            return min(1, Double(step) / Double(steps))
        }
    }

    enum Kind: String, Codable, Hashable, Sendable {
        case deposit
        case bankDeposit = "bank_deposit"
        case payout
        case send
    }

    var kind: Kind
    var refId: String
    var amount: String
    var from: String
    var to: String

    var title: String {
        switch kind {
        case .deposit, .bankDeposit: "Deposit"
        case .payout: "Withdrawal"
        case .send: "Send"
        }
    }
}
