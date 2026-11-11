import Observation

enum AppRoute: Hashable {
    case payNew
    case payPerson
    case payAmount
    case payQuote
    case paySending
    case payPaid
    case payRefunded
    case agents
    case settings
    case settingsAccounts
    case settingsSecurity
    case settingsNotifications
    case agentConnect
    case withdraw
    case withdrawTo
    case withdrawReview
    case receipt(payoutId: String)
}

@MainActor
@Observable
final class AppRouter {
    var path: [AppRoute] = []

    func push(_ route: AppRoute) {
        path.append(route)
    }

    /// Replaces the whole stack, for steps that must not be backed out of (a sent payout).
    func replace(with route: AppRoute) {
        path = [route]
    }

    func reset() {
        path.removeAll()
    }
}
