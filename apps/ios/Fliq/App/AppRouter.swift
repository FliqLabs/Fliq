import Observation

enum AppRoute: Hashable {
    case payNew
    case payAmount
    case payQuote
    case paySending
    case payPaid
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
