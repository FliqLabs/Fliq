import ActivityKit
import Foundation

/// Money on its way, in the Dynamic Island and on the Lock Screen, so nobody waits inside the app. The app starts it
/// and moves it while open; the API pushes the rest with the app closed and ends it at the last step.
@MainActor
final class LiveMoney {
    static let shared = LiveMoney()

    typealias State = MoneyActivityAttributes.ContentState

    private var register: (@Sendable (LiveActivityRegistration) async throws -> Void)?

    func start(_ environment: AppEnvironment) {
        guard environment.isLive else { return }
        let api = environment.api
        register = { try await api.registerLiveActivity($0) }
    }

    func show(_ attributes: MoneyActivityAttributes, _ state: State, final: Bool) {
        if let current = Self.activity(for: attributes.refId) {
            move(current, to: state, final: final)
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let content = ActivityContent(state: state, staleDate: nil)
        let pushType: PushType? = register == nil || final ? nil : .token
        guard let activity = try? Activity.request(attributes: attributes, content: content, pushType: pushType) else { return }
        if final {
            move(activity, to: state, final: true)
            return
        }
        guard let register else { return }
        let kind = attributes.kind.rawValue
        let refId = attributes.refId
        Task {
            for await token in activity.pushTokenUpdates {
                let hex = token.map { String(format: "%02x", $0) }.joined()
                try? await register(LiveActivityRegistration(
                    token: hex, kind: kind, refId: refId,
                    environment: PushNotifications.apnsEnvironment, bundleId: Bundle.main.bundleIdentifier ?? ""
                ))
            }
        }
    }

    private func move(_ activity: Activity<MoneyActivityAttributes>, to state: State, final: Bool) {
        guard activity.content.state != state || final else { return }
        let content = ActivityContent(state: state, staleDate: nil)
        let id = activity.id
        Task.detached {
            guard let activity = Activity<MoneyActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
            if final {
                await activity.end(content, dismissalPolicy: .after(.now.addingTimeInterval(15 * 60)))
            } else {
                await activity.update(content)
            }
        }
    }

    private static func activity(for refId: String) -> Activity<MoneyActivityAttributes>? {
        Activity<MoneyActivityAttributes>.activities.first {
            $0.attributes.refId == refId && $0.activityState == .active
        }
    }
}

// The same steps and words the API pushes, so an update from the app and one from the server never disagree.
extension LiveMoney {
    nonisolated static func deposit(_ status: DepositStatus, chain: String) -> State {
        let reached = status.bridgingAt != nil ? 2 : status.seenAt != nil ? 1 : 0
        switch status.stage {
        case .waiting: return State(step: 0, steps: 3, status: "Waiting for it", done: false, failed: false)
        case .seen: return State(step: 1, steps: 3, status: "Seen on \(chainName(chain))", done: false, failed: false)
        case .bridging: return State(step: 2, steps: 3, status: "Moving to your vault", done: false, failed: false)
        case .landed: return State(step: 3, steps: 3, status: "In your vault", done: true, failed: false)
        case .underpaid: return State(step: max(1, reached), steps: 3, status: "Too little sent", done: false, failed: true)
        case .refunded: return State(step: reached, steps: 3, status: "Refunded", done: false, failed: true)
        case .expired: return State(step: reached, steps: 3, status: "Nothing arrived", done: false, failed: true)
        case .failed: return State(step: reached, steps: 3, status: "Didn't arrive", done: false, failed: true)
        }
    }

    nonisolated static func payout(_ state: PayoutState) -> State {
        switch state {
        case .created, .providerTimeout, .awaitingRecon, .awaitingDeposit:
            State(step: 0, steps: 3, status: "Sending", done: false, failed: false)
        case .depositSeen, .routing:
            State(step: 1, steps: 3, status: "On its way to the bank", done: false, failed: false)
        case .withProvider, .payingOut:
            State(step: 2, steps: 3, status: "The bank is paying", done: false, failed: false)
        case .settled:
            State(step: 3, steps: 3, status: "Paid out", done: true, failed: false)
        case .refunding:
            State(step: 2, steps: 3, status: "Refunding", done: false, failed: true)
        case .refunded:
            State(step: 2, steps: 3, status: "Refunded to your vault", done: false, failed: true)
        case .expired, .failed, .refused, .notReceived:
            State(step: 0, steps: 3, status: "Not paid", done: false, failed: true)
        }
    }

    nonisolated static func chainName(_ chain: String) -> String {
        switch chain {
        case "near": "NEAR"
        case "bnb": "BNB Chain"
        default: chain.prefix(1).uppercased() + chain.dropFirst()
        }
    }

    /// "Moniepoint Microfinance Bank ••5320".
    nonisolated static func bankLine(institution: String, number: String) -> String {
        "\(institution) ••\(number.suffix(4))"
    }
}

struct LiveActivityRegistration: Encodable, Equatable, Sendable {
    let token: String
    let kind: String
    let refId: String
    let environment: String
    let bundleId: String
}
