import Foundation
import Observation

@MainActor
@Observable
final class HomeModel {
    private(set) var rate: Rate?
    private(set) var rateFailed = false

    /// The spec has no balance endpoint yet, so Home starts from the empty state.
    private(set) var balance: TokenAmount = .zero

    private let api: any FliqAPI

    init(api: any FliqAPI) {
        self.api = api
    }

    var hasBalance: Bool { balance > .zero }

    func load() async {
        do {
            rate = try await api.rate(.usdc, .ngn)
            rateFailed = false
        } catch {
            rateFailed = true
        }
    }
}
